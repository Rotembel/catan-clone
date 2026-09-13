// The authoritative game room (SPEC.md §7 Phases 2-3).
//
// Colyseus gives us rooms, sessions and broadcast; the engine gives us the
// rules. This class is the thin glue: it maps connections to seats, turns
// each incoming intent into an ActionEnvelope with the *server's* idea of
// who sent it, runs `apply`, and broadcasts the resulting GameState as-is.
// No game rule lives here.
//
// Stability (Phase 3): the whole record is persisted after every change,
// and a room created for a code the store already knows rehydrates from
// it. So a server restart only means the next join recreates the room —
// nobody loses the game. Seats survive disconnects; a seat token reclaims
// one (kicking any stale connection), and a game with someone "away" just
// keeps waiting for them.
//
// State is kept as the engine's plain GameState and shipped as a message
// rather than mirrored into a Colyseus Schema — one type source, and the
// snapshot on the wire is exactly what the engine produced.

import { Room, ServerError, type Client } from "@colyseus/core";
import { apply, createInitialState, IllegalActionError } from "@catan/engine";
import { createRuleSet, ruleSetInfo } from "@catan/rulesets";
import {
  CLOSE_SUPERSEDED,
  EVT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MSG,
  type Action,
  type GameState,
  type JoinOptions,
  type RoomSnapshot,
  type RuleSet,
  type StartOptions,
} from "@catan/shared";
import { randomBytes } from "node:crypto";
import { MemoryStore, type GameRecord, type GameStore, type StoredSeat } from "./store.js";

interface SeatRecord extends StoredSeat {
  sessionId: string | undefined;
}

/** Server-side defaults merged into what the client sends (see index.ts). */
export interface ServerOptions {
  store?: GameStore;
}

/** What onCreate sees: the client's join options plus the server defaults. */
export type RoomOptions = Partial<JoinOptions> & ServerOptions;

/** How long an empty room lingers before it's disposed — it rehydrates on the next join anyway. */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

export class CatanRoom extends Room {
  // Player count is enforced per-seat in onJoin; keeping maxClients above it
  // means the room never gets unlisted as "full", so joinOrCreate keeps
  // finding it (and never spawns a duplicate room for the same code).
  override maxClients = MAX_PLAYERS * 4;
  override autoDispose = false;

  private code = "";
  private seats: SeatRecord[] = [];
  private ruleSet: RuleSet | undefined;
  private game: GameState | undefined;
  private store: GameStore = new MemoryStore();
  private createdAt = Date.now();
  private emptyTimer: ReturnType<typeof setTimeout> | undefined;

  override async onCreate(options: RoomOptions): Promise<void> {
    this.code = String(options.code ?? "").toUpperCase();
    if (options.store) this.store = options.store;
    this.setMetadata({ code: this.code });

    const record = await this.store.load(this.code);
    if (record) {
      this.rehydrate(record);
    } else if (!options.create) {
      throw new ServerError(4302, "no game with that code");
    }

    this.onMessage(MSG.start, (client, options?: StartOptions) => void this.handleStart(client, options));
    this.onMessage(MSG.action, (client, action: Action) => void this.handleAction(client, action));
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    this.clearEmptyTimer();
    const name = sanitizeName(options.name);

    // A returning player (refresh, dropped connection, server restart)
    // presents their token. Any connection still holding the seat is stale.
    const reclaimed = options.seatToken
      ? this.seats.find((s) => s.token === options.seatToken)
      : undefined;
    if (reclaimed) {
      const stale = this.clients.find((c) => c.sessionId === reclaimed.sessionId && c !== client);
      stale?.leave(CLOSE_SUPERSEDED);
      reclaimed.sessionId = client.sessionId;
      reclaimed.connected = true;
      if (name) reclaimed.name = name;
      this.sendSeat(client, reclaimed);
      this.broadcastRoom();
      this.sendGameTo(client);
      await this.persist();
      return;
    }

    if (this.game) {
      throw new ServerError(4300, "this game has already started");
    }
    if (this.seats.length >= MAX_PLAYERS) {
      throw new ServerError(4301, "this room is full");
    }

    const seat: SeatRecord = {
      playerId: this.seats.length,
      name: name || `Player ${this.seats.length + 1}`,
      connected: true,
      isHost: this.seats.length === 0,
      token: randomBytes(16).toString("hex"),
      sessionId: client.sessionId,
    };
    this.seats.push(seat);
    this.sendSeat(client, seat);
    this.broadcastRoom();
    await this.persist();
  }

  override async onLeave(client: Client): Promise<void> {
    const seat = this.seatFor(client);
    if (seat) {
      seat.connected = false;
      seat.sessionId = undefined;
    }
    // In the lobby, a departing player simply gives up the seat.
    if (!this.game && seat) {
      this.seats = this.seats.filter((s) => s !== seat).map((s, i) => ({ ...s, playerId: i }));
      if (!this.seats.some((s) => s.isHost) && this.seats[0]) this.seats[0].isHost = true;
    }
    this.broadcastRoom();
    await this.persist();
    if (this.clients.length === 0) this.startEmptyTimer();
  }

  override async onDispose(): Promise<void> {
    this.clearEmptyTimer();
    // A finished game, or an abandoned lobby, has nothing left to resume.
    if (this.game?.winner !== undefined || (!this.game && this.seats.length === 0)) {
      await this.store.delete(this.code);
    }
  }

  // -- handlers ------------------------------------------------------------

  private async handleStart(client: Client, options?: StartOptions): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat?.isHost) return this.fail(client, "only the host can start the game");
    if (this.game) return this.fail(client, "the game has already started");
    if (this.seats.length < MIN_PLAYERS) {
      return this.fail(client, `need at least ${MIN_PLAYERS} players`);
    }
    const ruleSetId = options?.ruleSetId;
    if (ruleSetId !== undefined && !ruleSetInfo(ruleSetId)) {
      return this.fail(client, `unknown rule set: ${ruleSetId}`);
    }

    // The seed is server-chosen; the engine itself stays deterministic.
    const seed = `${this.code}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const { ruleSet, state } = createRuleSet(ruleSetId, { seed });
    this.ruleSet = ruleSet;
    this.game = createInitialState(ruleSet, {
      playerNames: this.seats.map((s) => s.name),
      rngState: state,
    });

    await this.persist();
    this.broadcastRoom();
    this.broadcast(EVT.ruleset, this.ruleSet);
    this.broadcast(EVT.game, this.game);
  }

  private async handleAction(client: Client, action: Action): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat) return this.fail(client, "you are not seated in this game");
    if (!this.game || !this.ruleSet) return this.fail(client, "the game has not started");

    try {
      // playerId comes from the seat, never from the client's payload.
      this.game = apply(this.game, { playerId: seat.playerId, action }, this.ruleSet);
    } catch (error) {
      if (error instanceof IllegalActionError) return this.fail(client, error.message);
      console.error("unexpected engine error", error);
      return this.fail(client, "internal error applying that action");
    }

    // Durable first, then visible.
    await this.persist();
    this.broadcast(EVT.game, this.game);
  }

  // -- persistence ---------------------------------------------------------

  private rehydrate(record: GameRecord): void {
    this.createdAt = record.createdAt;
    this.seats = record.seats.map((s) => ({ ...s, connected: false, sessionId: undefined }));
    this.ruleSet = record.ruleSet;
    this.game = record.game;
    this.startEmptyTimer();
  }

  private toRecord(): GameRecord {
    return {
      code: this.code,
      seats: this.seats.map(({ playerId, name, connected, isHost, token }) => ({
        playerId,
        name,
        connected,
        isHost,
        token,
      })),
      ruleSet: this.ruleSet,
      game: this.game,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    };
  }

  private async persist(): Promise<void> {
    try {
      await this.store.save(this.toRecord());
    } catch (error) {
      // Play must not stall on a storage hiccup; the next write will retry.
      console.error(`failed to persist room ${this.code}`, error);
    }
  }

  // -- helpers -------------------------------------------------------------

  private seatFor(client: Client): SeatRecord | undefined {
    return this.seats.find((s) => s.sessionId === client.sessionId);
  }

  private sendSeat(client: Client, seat: SeatRecord): void {
    client.send(EVT.seat, { playerId: seat.playerId, seatToken: seat.token });
  }

  private sendGameTo(client: Client): void {
    if (!this.game || !this.ruleSet) return;
    client.send(EVT.ruleset, this.ruleSet);
    client.send(EVT.game, this.game);
  }

  private snapshot(): RoomSnapshot {
    return {
      code: this.code,
      started: this.game !== undefined,
      seats: this.seats.map(({ playerId, name, connected, isHost }) => ({
        playerId,
        name,
        connected,
        isHost,
      })),
    };
  }

  private broadcastRoom(): void {
    this.broadcast(EVT.room, this.snapshot());
  }

  private fail(client: Client, message: string): void {
    client.send(EVT.error, { message });
  }

  private startEmptyTimer(): void {
    this.clearEmptyTimer();
    this.emptyTimer = setTimeout(() => void this.disconnect(), EMPTY_ROOM_TTL_MS);
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = undefined;
  }
}

function sanitizeName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 20);
}
