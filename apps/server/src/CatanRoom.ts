// The authoritative game room (SPEC.md §7 Phase 2).
//
// Colyseus gives us rooms, sessions and broadcast; the engine gives us the
// rules. This class is the thin glue: it maps connections to seats, turns
// each incoming intent into an ActionEnvelope with the *server's* idea of
// who sent it, runs `apply`, and broadcasts the resulting GameState as-is.
// No game rule lives here.
//
// State is kept as the engine's plain GameState and shipped as a message
// rather than mirrored into a Colyseus Schema — one type source, and the
// snapshot on the wire is exactly what the engine produced.

import { Room, ServerError, type Client } from "@colyseus/core";
import { apply, createInitialState, IllegalActionError } from "@catan/engine";
import { createBaseRuleSet } from "@catan/rulesets";
import {
  EVT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MSG,
  type Action,
  type GameState,
  type JoinOptions,
  type RoomSnapshot,
  type RuleSet,
  type Seat,
} from "@catan/shared";
import { randomBytes } from "node:crypto";

interface SeatRecord extends Seat {
  /** Secret handed to the client; presenting it again reclaims the seat. */
  token: string;
  sessionId: string | undefined;
}

/** How long an empty room lingers before it's disposed (a refresh shouldn't kill it). */
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;

export class CatanRoom extends Room {
  override maxClients = MAX_PLAYERS;
  override autoDispose = false;

  private code = "";
  private seats: SeatRecord[] = [];
  private ruleSet: RuleSet | undefined;
  private game: GameState | undefined;
  private emptyTimer: ReturnType<typeof setTimeout> | undefined;

  override onCreate(options: JoinOptions): void {
    this.code = String(options.code ?? "").toUpperCase();
    this.setMetadata({ code: this.code });

    this.onMessage(MSG.start, (client) => this.handleStart(client));
    this.onMessage(MSG.action, (client, action: Action) => this.handleAction(client, action));
  }

  override onJoin(client: Client, options: JoinOptions): void {
    this.clearEmptyTimer();
    const name = sanitizeName(options.name);

    // A returning player (refresh, dropped connection) presents their token.
    const reclaimed = options.seatToken
      ? this.seats.find((s) => s.token === options.seatToken)
      : undefined;
    if (reclaimed) {
      reclaimed.sessionId = client.sessionId;
      reclaimed.connected = true;
      if (name) reclaimed.name = name;
      this.sendSeat(client, reclaimed);
      this.broadcastRoom();
      this.sendGameTo(client);
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
  }

  override onLeave(client: Client): void {
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
    if (this.clients.length === 0) this.startEmptyTimer();
  }

  override onDispose(): void {
    this.clearEmptyTimer();
  }

  // -- handlers ------------------------------------------------------------

  private handleStart(client: Client): void {
    const seat = this.seatFor(client);
    if (!seat?.isHost) return this.fail(client, "only the host can start the game");
    if (this.game) return this.fail(client, "the game has already started");
    if (this.seats.length < MIN_PLAYERS) {
      return this.fail(client, `need at least ${MIN_PLAYERS} players`);
    }

    // The seed is server-chosen; the engine itself stays deterministic.
    const seed = `${this.code}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const { ruleSet, state } = createBaseRuleSet({ seed });
    this.ruleSet = ruleSet;
    this.game = createInitialState(ruleSet, {
      playerNames: this.seats.map((s) => s.name),
      rngState: state,
    });

    this.broadcastRoom();
    this.broadcast(EVT.ruleset, this.ruleSet);
    this.broadcast(EVT.game, this.game);
  }

  private handleAction(client: Client, action: Action): void {
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

    this.broadcast(EVT.game, this.game);
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
