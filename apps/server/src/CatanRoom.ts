// The authoritative game room (SPEC.md §7 Phases 2-3, HOME STABLE v0.1).
//
// Colyseus gives us rooms, sessions and broadcast; the engine gives us the
// rules. This class is the thin glue: it maps connections to seats, turns
// each incoming intent into an ActionEnvelope with the *server's* idea of
// who sent it, runs `apply`, and broadcasts the resulting GameState as-is.
// No game rule lives here.
//
// Bot seats (HOME_LAN_VERSION_WRAP.md §6-7) are seats with no connection.
// When `nextActor` says a bot must move, the room asks the shared pure bot
// (`chooseAction`) and pushes the answer through the *same* apply/persist/
// broadcast path a human intent takes. One timer per room, re-armed after
// every state change, so there is never more than one pending bot move.
// Each bot's RNG state is persisted with its seat, so a restart replays the
// same decisions; bots only play while at least one human is connected.
//
// Stability (Phase 3): the whole record is persisted after every change,
// and a room created for a code the store already knows rehydrates from
// it. So a server restart only means the next join recreates the room —
// nobody loses the game.

import { Room, ServerError, type Client } from "@colyseus/core";
import { apply, createInitialState, IllegalActionError, normalizeState, createRng } from "@catan/engine";
import { chooseAction, nextActor } from "@catan/bot";
import { createRuleSet, ruleSetInfo } from "@catan/rulesets";
import {
  CLOSE_SUPERSEDED,
  EVT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MSG,
  type Action,
  type BuildInfo,
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
  build?: BuildInfo;
  /** Human-readable persistence location for the diagnostics line. */
  persistence?: string;
  /** Pause before each bot move so humans can follow along. 0 in tests. */
  botDelayMs?: number;
}

/** What onCreate sees: the client's join options plus the server defaults. */
export type RoomOptions = Partial<JoinOptions> & ServerOptions;

const DEFAULT_BUILD: BuildInfo = { appVersion: "0.0.0", gitCommit: "unknown", buildProfile: "dev", mapGenerationVersion: "mapgen-v1" };

/** How long an empty room lingers before it's disposed — it rehydrates on the next join anyway. */
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

const BOT_NAMES = ["Bot Ada", "Bot Grace", "Bot Alan", "Bot Edsger", "Bot Linus"];

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
  private build: BuildInfo = DEFAULT_BUILD;
  private persistence = "memory";
  private botDelayMs = 700;
  private createdAt = Date.now();
  private emptyTimer: ReturnType<typeof setTimeout> | undefined;
  private botTimer: ReturnType<typeof setTimeout> | undefined;
  /** Serialises applies so a bot move can't interleave with a human's. */
  private applying = false;

  override async onCreate(options: RoomOptions): Promise<void> {
    this.code = String(options.code ?? "").toUpperCase();
    if (options.store) this.store = options.store;
    if (options.build) this.build = options.build;
    if (options.persistence) this.persistence = options.persistence;
    if (options.botDelayMs !== undefined) this.botDelayMs = options.botDelayMs;
    this.setMetadata({ code: this.code });

    const record = await this.store.load(this.code);
    if (record) {
      this.rehydrate(record);
    } else if (!options.create) {
      throw new ServerError(4302, "no game with that code");
    }

    this.onMessage(MSG.start, (client, options?: StartOptions) => void this.handleStart(client, options));
    this.onMessage(MSG.action, (client, action: Action) => void this.handleAction(client, action));
    this.onMessage(MSG.addBot, (client) => void this.handleAddBot(client));
    this.onMessage(MSG.removeBot, (client, payload: { playerId: number }) => void this.handleRemoveBot(client, payload?.playerId));
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    this.clearEmptyTimer();
    const name = sanitizeName(options.name);

    // A returning player (refresh, dropped connection, server restart)
    // presents their token. Any connection still holding the seat is stale.
    const reclaimed = options.seatToken
      ? this.seats.find((s) => s.token === options.seatToken && s.kind === "human")
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
      this.scheduleBots();
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
      isHost: !this.seats.some((s) => s.isHost),
      kind: "human",
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
      if (!this.seats.some((s) => s.isHost)) {
        const firstHuman = this.seats.find((s) => s.kind === "human");
        if (firstHuman) firstHuman.isHost = true;
      }
    }
    this.broadcastRoom();
    await this.persist();
    if (this.humansConnected() === 0) {
      this.stopBots(); // nobody is watching; bots wait for a human to return
      if (this.clients.length === 0) this.startEmptyTimer();
    }
  }

  override async onDispose(): Promise<void> {
    this.clearEmptyTimer();
    this.stopBots();
    // A finished game, or an abandoned lobby, has nothing left to resume.
    if (this.game?.winner !== undefined || (!this.game && this.seats.length === 0)) {
      await this.store.delete(this.code);
    }
  }

  // -- lobby ---------------------------------------------------------------

  private async handleAddBot(client: Client): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat?.isHost) return this.fail(client, "only the host can add bots");
    if (this.game) return this.fail(client, "the game has already started");
    if (this.seats.length >= MAX_PLAYERS) return this.fail(client, "this room is full");

    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.seats.length + 1}`;
    this.seats.push({
      playerId: this.seats.length,
      name,
      connected: true,
      isHost: false,
      kind: "bot",
      token: randomBytes(16).toString("hex"),
      sessionId: undefined,
      botRng: createRng(`${this.code}-bot-${randomBytes(4).toString("hex")}`),
    });
    this.broadcastRoom();
    await this.persist();
  }

  private async handleRemoveBot(client: Client, playerId: number | undefined): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat?.isHost) return this.fail(client, "only the host can remove bots");
    if (this.game) return this.fail(client, "the game has already started");
    const bot = this.seats.find((s) => s.playerId === playerId && s.kind === "bot");
    if (!bot) return this.fail(client, "no such bot seat");
    this.seats = this.seats.filter((s) => s !== bot).map((s, i) => ({ ...s, playerId: i }));
    this.broadcastRoom();
    await this.persist();
  }

  // -- handlers ------------------------------------------------------------

  private async handleStart(client: Client, options?: StartOptions): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat?.isHost) return this.fail(client, "only the host can start the game");
    if (this.game) return this.fail(client, "the game has already started");
    if (this.seats.length < MIN_PLAYERS) {
      return this.fail(client, `need at least ${MIN_PLAYERS} players`);
    }
    const ruleSetId = options?.ruleSetId ?? "base";
    const info = ruleSetInfo(ruleSetId);
    if (!info) return this.fail(client, `unknown rule set: ${ruleSetId}`);
    if (this.seats.length > info.seats.max || this.seats.length < info.seats.min) {
      return this.fail(client, `${info.label} seats ${info.seats.min}-${info.seats.max} players; this room has ${this.seats.length}`);
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
    this.scheduleBots();
  }

  private async handleAction(client: Client, action: Action): Promise<void> {
    const seat = this.seatFor(client);
    if (!seat) return this.fail(client, "you are not seated in this game");
    if (!this.game || !this.ruleSet) return this.fail(client, "the game has not started");
    await this.applyEnvelope(seat.playerId, action, client);
  }

  /**
   * The one path every action takes — human or bot: engine, then store,
   * then everyone, then "is it a bot's move now?".
   */
  private async applyEnvelope(playerId: number, action: Action, client?: Client): Promise<boolean> {
    if (!this.game || !this.ruleSet) return false;
    if (this.applying) {
      if (client) this.fail(client, "busy — try again");
      return false;
    }
    this.applying = true;
    try {
      // playerId comes from the seat, never from the client's payload.
      this.game = apply(this.game, { playerId, action }, this.ruleSet);
    } catch (error) {
      this.applying = false;
      if (error instanceof IllegalActionError) {
        if (client) this.fail(client, error.message);
        else console.error(`bot ${playerId} chose an illegal action`, error.message);
        return false;
      }
      console.error("unexpected engine error", error);
      if (client) this.fail(client, "internal error applying that action");
      return false;
    }

    // Durable first, then visible.
    await this.persist();
    this.applying = false;
    this.broadcast(EVT.game, this.game);
    this.scheduleBots();
    return true;
  }

  // -- bots ----------------------------------------------------------------

  private humansConnected(): number {
    return this.seats.filter((s) => s.kind === "human" && s.connected).length;
  }

  /** (Re)arm the single bot timer if the next actor is a bot and a human is watching. */
  private scheduleBots(): void {
    this.stopBots();
    if (!this.game || !this.ruleSet || this.game.winner !== undefined) return;
    if (this.humansConnected() === 0) return;
    const actor = nextActor(this.game);
    if (actor === undefined) return;
    const seat = this.seats.find((s) => s.playerId === actor);
    if (seat?.kind !== "bot") return;
    this.botTimer = setTimeout(() => void this.runBotMove(actor), this.botDelayMs);
  }

  private stopBots(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = undefined;
  }

  private async runBotMove(playerId: number): Promise<void> {
    this.botTimer = undefined;
    if (!this.game || !this.ruleSet) return;
    // The world may have moved on since the timer was armed.
    if (nextActor(this.game) !== playerId) return this.scheduleBots();
    const seat = this.seats.find((s) => s.playerId === playerId);
    if (!seat || seat.kind !== "bot") return;

    const rng = seat.botRng ?? createRng(`${this.code}-bot-${playerId}`);
    const choice = chooseAction(this.game, this.ruleSet, playerId, rng);
    seat.botRng = choice.rng;
    if (!choice.action) {
      console.error(`bot ${seat.name} has no legal action in phase ${this.game.turn.phase}`);
      return;
    }
    await this.applyEnvelope(playerId, choice.action);
  }

  // -- persistence ---------------------------------------------------------

  private rehydrate(record: GameRecord): void {
    this.createdAt = record.createdAt;
    this.seats = record.seats.map((s) => ({
      ...s,
      kind: s.kind ?? "human",
      connected: s.kind === "bot",
      sessionId: undefined,
    }));
    this.ruleSet = record.ruleSet;
    this.game = record.game ? normalizeState(record.game) : undefined;
    if (record.build) this.build = record.build;
    this.startEmptyTimer();
    // Bots resume as soon as a human is back (scheduleBots on join).
  }

  private toRecord(): GameRecord {
    return {
      code: this.code,
      seats: this.seats.map(({ playerId, name, connected, isHost, kind, token, botRng }) => ({
        playerId,
        name,
        connected,
        isHost,
        kind,
        token,
        ...(botRng ? { botRng } : {}),
      })),
      ruleSet: this.ruleSet,
      game: this.game,
      build: this.build,
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
      seats: this.seats.map(({ playerId, name, connected, isHost, kind }) => ({ playerId, name, connected, isHost, kind })),
      build: this.build,
      persistence: this.persistence,
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
