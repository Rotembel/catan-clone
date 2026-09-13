// End-to-end room tests: real Colyseus server, real client sockets. Proves
// the server-authority contract — the seat decides who you are, the engine
// decides what's legal, and everyone sees the same state.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import { createInitialState, legalActions, pieceCounts, startInteraction } from "@catan/engine";
import { createRuleSet } from "@catan/rulesets";
import { chooseAction, nextActor } from "@catan/bot";
import {
  CLOSE_SUPERSEDED,
  EVT,
  MSG,
  ROOM_NAME,
  type Action,
  type ActionEnvelope,
  type ErrorPayload,
  type GameState,
  type RoomSnapshot,
  type RuleSet,
  type SeatPayload,
} from "@catan/shared";
import { CatanRoom } from "../src/CatanRoom.js";
import { MemoryStore, type GameStore } from "../src/store.js";
import type { BotPacing } from "../src/botPacing.js";

let server: ColyseusTestServer;
// One store for the whole file (the room handler captures it at define
// time); each test starts with it wiped.
const store: GameStore & { clear(): void } = new MemoryStore();

const TEST_BUILD = { appVersion: "0.6.0-test", gitCommit: "abc1234", buildProfile: "dev" as const, mapGenerationVersion: "mapgen-v1" };

async function bootServer(withStore: GameStore, botPacing?: BotPacing): Promise<ColyseusTestServer> {
  return boot({
    options: {},
    initializeGameServer: (gameServer) => {
      gameServer
        .define(ROOM_NAME, CatanRoom, { store: withStore, build: TEST_BUILD, persistence: "memory", botDelayMs: 0, ...(botPacing ? { botPacing } : {}) })
        .filterBy(["code"]);
    },
  });
}

beforeAll(async () => {
  server = await bootServer(store);
});

afterAll(async () => {
  await server.shutdown();
});

beforeEach(async () => {
  await server.cleanup();
  store.clear();
});

/** A client connection plus a mailbox of everything the server sent it. */
interface Peer {
  room: ClientRoom;
  seat: SeatPayload;
  snapshots: RoomSnapshot[];
  games: GameState[];
  actions: ActionEnvelope[];
  errors: ErrorPayload[];
  ruleSet?: RuleSet;
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = check();
      if (value !== undefined) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function connect(
  code: string,
  name: string,
  seatToken?: string,
  create = false
): Promise<Peer> {
  const peer: Partial<Peer> & { snapshots: RoomSnapshot[]; games: GameState[]; actions: ActionEnvelope[]; errors: ErrorPayload[] } = {
    snapshots: [],
    games: [],
    actions: [],
    errors: [],
  };

  // A freshly (re)booted server can reset the first connection attempt.
  let room: ClientRoom | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      room = create
        ? await server.sdk.create(ROOM_NAME, { code, name, create: true })
        : await server.sdk.joinOrCreate(ROOM_NAME, { code, name, seatToken });
      break;
    } catch (error) {
      if (attempt < 5 && /ECONNRESET|ECONNREFUSED/.test(String(error))) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      throw error;
    }
  }
  peer.room = room;
  room.onMessage(EVT.seat, (seat: SeatPayload) => (peer.seat = seat));
  room.onMessage(EVT.room, (snap: RoomSnapshot) => peer.snapshots.push(snap));
  room.onMessage(EVT.game, (game: GameState) => peer.games.push(game));
  room.onMessage(EVT.action, (envelope: ActionEnvelope) => peer.actions.push(envelope));
  room.onMessage(EVT.ruleset, (rs: RuleSet) => (peer.ruleSet = rs));
  room.onMessage(EVT.error, (err: ErrorPayload) => peer.errors.push(err));

  await waitFor(() => peer.seat);
  return peer as Peer;
}

const latestGame = (p: Peer) => p.games[p.games.length - 1];

async function startedGame(code: string, ruleSetId?: string): Promise<[Peer, Peer]> {
  const host = await connect(code, "Ada", undefined, true);
  const guest = await connect(code, "Grace");
  await waitFor(() => (host.snapshots.at(-1)?.seats.length === 2 ? true : undefined));

  host.room.send(MSG.start, ruleSetId ? { ruleSetId } : undefined);
  await waitFor(() => (host.games.length > 0 && guest.games.length > 0 ? true : undefined));
  await waitFor(() => host.ruleSet);
  return [host, guest];
}


describe("CatanRoom", () => {
  it("seats players in join order and tells each who they are", async () => {
    const host = await connect("ROOM", "Ada", undefined, true);
    const guest = await connect("ROOM", "Grace");

    expect(host.seat.playerId).toBe(0);
    expect(guest.seat.playerId).toBe(1);
    expect(host.seat.seatToken).not.toBe(guest.seat.seatToken);

    const snap = await waitFor(() => {
      const s = guest.snapshots.at(-1);
      return s?.seats.length === 2 ? s : undefined;
    });
    expect(snap.code).toBe("ROOM");
    expect(snap.started).toBe(false);
    expect(snap.seats.map((s) => s.name)).toEqual(["Ada", "Grace"]);
    expect(snap.seats[0]?.isHost).toBe(true);
    expect(snap.seats[1]?.isHost).toBe(false);
  });

  it("only the host can start, and only with enough players", async () => {
    const host = await connect("SOLO", "Ada", undefined, true);
    host.room.send(MSG.start);
    const err = await waitFor(() => host.errors[0]);
    expect(err.message).toMatch(/at least 2/);

    const guest = await connect("SOLO", "Grace");
    guest.room.send(MSG.start);
    const guestErr = await waitFor(() => guest.errors[0]);
    expect(guestErr.message).toMatch(/only the host/);
  });

  it("starting sends everyone the same ruleset and initial state", async () => {
    const [host, guest] = await startedGame("INIT");
    expect(host.ruleSet?.board.hexes).toHaveLength(19);
    expect(guest.ruleSet).toEqual(host.ruleSet);

    const g = latestGame(host)!;
    expect(g.turn.phase).toBe("setupSettlement1");
    expect(g.players.map((p) => p.name)).toEqual(["Ada", "Grace"]);
    expect(latestGame(guest)).toEqual(g);
  });

  it("applies a legal action and broadcasts the new state to all", async () => {
    const [host, guest] = await startedGame("ACT1");
    const g = latestGame(host)!;
    const legal = legalActions(g, host.ruleSet!, 0);
    const place = legal.find((a) => a.type === "buildSettlement") as Action;

    host.room.send(MSG.action, place);
    const next = await waitFor(() => (host.games.length >= 2 ? latestGame(host) : undefined));
    expect(next.turn.phase).toBe("setupRoad1");
    expect(Object.keys(next.board.buildings)).toHaveLength(1);

    const guestNext = await waitFor(() => (guest.games.length >= 2 ? latestGame(guest) : undefined));
    expect(guestNext).toEqual(next);
  });

  it("rejects an action from a player whose turn it is not — the seat decides identity", async () => {
    const [host, guest] = await startedGame("SEAT");
    const g = latestGame(host)!;
    // Grace (seat 1) tries to place Ada's first settlement.
    const place = legalActions(g, host.ruleSet!, 0).find((a) => a.type === "buildSettlement")!;

    guest.room.send(MSG.action, place);
    const err = await waitFor(() => guest.errors[0]);
    expect(err.message).toBeTruthy();
    // Nothing changed for anyone.
    expect(host.games).toHaveLength(1);
    expect(latestGame(host)!.board.buildings).toEqual({});
  });

  it("rejects an illegal action and leaves state untouched", async () => {
    const [host] = await startedGame("BAD1");
    host.room.send(MSG.action, { type: "rollDice" } satisfies Action); // not in setup
    const err = await waitFor(() => host.errors[0]);
    expect(err.message).toBeTruthy();
    expect(host.games).toHaveLength(1);
  });

  it("refuses new joins after the game has started", async () => {
    await startedGame("FULL");
    await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "FULL", name: "Late" })).rejects.toThrow(
      /already started/
    );
  });

  it("lets a dropped player reclaim their seat with the seat token and get the game back", async () => {
    const [host, guest] = await startedGame("BACK");
    const token = guest.seat.seatToken;
    await guest.room.leave();

    const gone = await waitFor(() => {
      const s = host.snapshots.at(-1);
      return s?.seats[1]?.connected === false ? s : undefined;
    });
    expect(gone.seats[1]?.connected).toBe(false);

    const back = await connect("BACK", "Grace", token);
    expect(back.seat.playerId).toBe(1);
    expect(back.seat.seatToken).toBe(token);
    await waitFor(() => back.ruleSet);
    await waitFor(() => back.games[0]);
    expect(latestGame(back)).toEqual(latestGame(host));

    const again = await waitFor(() => {
      const s = host.snapshots.at(-1);
      return s?.seats[1]?.connected === true ? s : undefined;
    });
    expect(again.seats[1]?.connected).toBe(true);
  });

  it("refuses to join a code nobody created", async () => {
    await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "NOPE", name: "Lost" })).rejects.toThrow(
      /no game with that code/
    );
  });

  it("persists the record after every applied action", async () => {
    const [host] = await startedGame("SAVE");
    const before = await store.load("SAVE");
    expect(before?.game?.turn.phase).toBe("setupSettlement1");
    expect(before?.seats.map((s) => s.name)).toEqual(["Ada", "Grace"]);
    expect(before?.seats.every((s) => s.token.length > 0)).toBe(true);

    const g = latestGame(host)!;
    const place = legalActions(g, host.ruleSet!, 0).find((a) => a.type === "buildSettlement")!;
    host.room.send(MSG.action, place);
    await waitFor(() => (host.games.length >= 2 ? true : undefined));

    const after = await store.load("SAVE");
    expect(after?.game).toEqual(latestGame(host));
    expect(after?.game?.turn.phase).toBe("setupRoad1");
  });

  it("survives a server restart: the next join rehydrates the game and play continues", async () => {
    const [host, guest] = await startedGame("LIVE");
    const g = latestGame(host)!;
    const place = legalActions(g, host.ruleSet!, 0).find((a) => a.type === "buildSettlement")!;
    host.room.send(MSG.action, place);
    await waitFor(() => (host.games.length >= 2 ? true : undefined));
    const lastSeen = latestGame(host)!;
    const hostToken = host.seat.seatToken;
    const guestToken = guest.seat.seatToken;

    // Kill the server. The store is the only thing that survives.
    await server.shutdown();
    server = await bootServer(store);

    const hostBack = await connect("LIVE", "Ada", hostToken);
    await waitFor(() => hostBack.games[0]);
    expect(hostBack.seat.playerId).toBe(0);
    expect(latestGame(hostBack)).toEqual(lastSeen);
    expect(hostBack.ruleSet).toEqual(host.ruleSet);

    const guestBack = await connect("LIVE", "Grace", guestToken);
    await waitFor(() => guestBack.games[0]);
    expect(guestBack.seat.playerId).toBe(1);

    // And the game goes on from exactly where it stopped.
    const road = legalActions(lastSeen, hostBack.ruleSet!, 0).find((a) => a.type === "buildRoad")!;
    hostBack.room.send(MSG.action, road);
    const next = await waitFor(() => (hostBack.games.length >= 2 ? latestGame(hostBack) : undefined));
    expect(next.turn.phase).toBe("setupSettlement1");
    expect(next.turn.current).toBe(1);
    const guestNext = await waitFor(() => (guestBack.games.length >= 2 ? latestGame(guestBack) : undefined));
    expect(guestNext).toEqual(next);
  });

  it("a second connection with the same token takes over the seat and the stale one is closed", async () => {
    const [host, guest] = await startedGame("DUPE");
    let closedWith: number | undefined;
    guest.room.onLeave((code) => (closedWith = code));

    const twin = await connect("DUPE", "Grace", guest.seat.seatToken);
    expect(twin.seat.playerId).toBe(1);
    await waitFor(() => closedWith);
    expect(closedWith).toBe(CLOSE_SUPERSEDED);

    // Only the twin can act for seat 1 now; there is still exactly one Grace.
    const snap = await waitFor(() => {
      const s = host.snapshots.at(-1);
      return s?.seats.length === 2 && s.seats[1]?.connected ? s : undefined;
    });
    expect(snap.seats.map((s) => s.name)).toEqual(["Ada", "Grace"]);
  });

  it("the game keeps going for the others while a player is away, and they catch up on return", async () => {
    const [host, guest] = await startedGame("AWAY");
    const token = guest.seat.seatToken;
    await guest.room.leave();
    await waitFor(() => (host.snapshots.at(-1)?.seats[1]?.connected === false ? true : undefined));

    // Ada plays her setup pieces while Grace is gone.
    const g = latestGame(host)!;
    const place = legalActions(g, host.ruleSet!, 0).find((a) => a.type === "buildSettlement")!;
    host.room.send(MSG.action, place);
    await waitFor(() => (host.games.length >= 2 ? true : undefined));
    const road = legalActions(latestGame(host)!, host.ruleSet!, 0).find((a) => a.type === "buildRoad")!;
    host.room.send(MSG.action, road);
    await waitFor(() => (host.games.length >= 3 ? true : undefined));

    const back = await connect("AWAY", "Grace", token);
    await waitFor(() => back.games[0]);
    expect(latestGame(back)).toEqual(latestGame(host));
    expect(latestGame(back)!.turn.current).toBe(1); // it's Grace's turn now
  });

  it("starts the base game by default, and the friends-night variant when the host asks", async () => {
    const [base] = await startedGame("BASE");
    expect(base.ruleSet?.id).toBe("base");
    expect(base.ruleSet?.houseRules.tradeDevCards).toBe(false);

    const [host, guest] = await startedGame("FRND", "friends-night");
    expect(host.ruleSet?.id).toBe("friends-night");
    expect(host.ruleSet?.houseRules.tradeDevCards).toBe(true);
    expect(guest.ruleSet).toEqual(host.ruleSet);

    // The choice survives a restart along with everything else.
    expect((await store.load("FRND"))?.ruleSet?.houseRules.tradeDevCards).toBe(true);
  });

  it("refuses to start with a rule set it doesn't know", async () => {
    const host = await connect("UNKN", "Ada", undefined, true);
    await connect("UNKN", "Grace");
    await waitFor(() => (host.snapshots.at(-1)?.seats.length === 2 ? true : undefined));
    host.room.send(MSG.start, { ruleSetId: "cities-and-dragons" });
    const err = await waitFor(() => host.errors[0]);
    expect(err.message).toMatch(/unknown rule set/);
    expect(host.games).toHaveLength(0);
  });

  it("sends build identity and persistence info in every lobby snapshot", async () => {
    const host = await connect("BLD1", "Ada", undefined, true);
    const snap = await waitFor(() => host.snapshots.at(-1));
    expect(snap.build).toEqual(TEST_BUILD);
    expect(snap.persistence).toBe("memory");
  });

  describe("5-seat lobby with bots", () => {
    /** Lets every socket message settle. */
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

    async function fullLobby(code: string): Promise<[Peer, Peer, Peer]> {
      const host = await connect(code, "Ada", undefined, true);
      const g1 = await connect(code, "Grace");
      const g2 = await connect(code, "Alan");
      host.room.send(MSG.addBot);
      host.room.send(MSG.addBot);
      await waitFor(() => (host.snapshots.at(-1)?.seats.length === 5 ? true : undefined));
      return [host, g1, g2];
    }

    it("seats 3 humans + 2 bots, refuses a 6th seat, and only the host manages bots", async () => {
      const [host, g1] = await fullLobby("FIVE");
      const snap = host.snapshots.at(-1)!;
      expect(snap.seats.map((s) => s.kind)).toEqual(["human", "human", "human", "bot", "bot"]);
      expect(snap.seats.filter((s) => s.kind === "bot").every((s) => s.connected)).toBe(true);
      expect(snap.seats.map((s) => s.playerId)).toEqual([0, 1, 2, 3, 4]);

      host.room.send(MSG.addBot);
      const full = await waitFor(() => host.errors[0]);
      expect(full.message).toMatch(/full/);
      await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "FIVE", name: "Sixth" })).rejects.toThrow(/full/);

      g1.room.send(MSG.removeBot, { playerId: 4 });
      const denied = await waitFor(() => g1.errors[0]);
      expect(denied.message).toMatch(/only the host/);

      host.room.send(MSG.removeBot, { playerId: 4 });
      await waitFor(() => (host.snapshots.at(-1)?.seats.length === 4 ? true : undefined));
      expect(host.snapshots.at(-1)!.seats.map((s) => s.kind)).toEqual(["human", "human", "human", "bot"]);
    });

    it("the base rule set refuses 5 seats; Home Large accepts them", async () => {
      const [host] = await fullLobby("SEAT");
      host.room.send(MSG.start, { ruleSetId: "base" });
      const err = await waitFor(() => host.errors[0]);
      expect(err.message).toMatch(/seats 2-4 players/);
      expect(host.games).toHaveLength(0);

      host.room.send(MSG.start, { ruleSetId: "home-large-5" });
      await waitFor(() => host.games[0]);
      expect(host.ruleSet?.id).toBe("home-large-5");
      expect(host.ruleSet?.board.hexes).toHaveLength(37);
      expect(host.games[0]!.players.map((p) => p.name)).toEqual(["Ada", "Grace", "Alan", "Bot Ada", "Bot Grace"]);
    });

    /** Drive the humans through setup with their first legal action; bots move themselves. */
    async function playSetupOverSockets(peers: Peer[], code: string): Promise<GameState> {
      const latest = () => peers[0]!.games.at(-1)!;
      let guard = 0;
      while (latest().turn.phase.startsWith("setup")) {
        if (guard++ > 400) throw new Error("setup did not finish over sockets");
        const state = latest();
        const actor = nextActor(state)!;
        const peer = peers.find((p) => p.seat.playerId === actor);
        if (peer) {
          const action = legalActions(state, peer.ruleSet!, actor)[0]!;
          const before = peers[0]!.games.length;
          peer.room.send(MSG.action, action);
          await waitFor(() => (peers[0]!.games.length > before ? true : undefined));
        } else {
          // A bot's move: the server acts on its own.
          const before = peers[0]!.games.length;
          await waitFor(() => (peers[0]!.games.length > before ? true : undefined));
        }
      }
      void code;
      return latest();
    }

    it("bots take their own setup turns server-side; humans can't act for them", async () => {
      const peers = await fullLobby("BOTS");
      peers[0].room.send(MSG.start, { ruleSetId: "home-large-5" });
      await waitFor(() => peers[2].games[0] && peers[0].ruleSet ? true : undefined);

      const done = await playSetupOverSockets(peers, "BOTS");
      expect(done.turn).toEqual({ current: 0, phase: "rollDice" });
      for (const p of done.players) expect(pieceCounts(done, p.id).settlements).toBe(3);

      // Every human saw the same state; a human intent for a bot's seat is refused.
      expect(peers[1].games.at(-1)).toEqual(done);
      // Ada rolls; if the roll doesn't hand the turn to a bot immediately we
      // end turns until it is a bot's move, then try to act as that bot.
      let state = done;
      let guard = 0;
      while (nextActor(state) !== 3 && guard++ < 60) {
        const actor = nextActor(state)!;
        const peer = peers.find((p) => p.seat.playerId === actor);
        const before = peers[0].games.length;
        if (peer) {
          const acts = legalActions(state, peer.ruleSet!, actor);
          const action = acts.find((a) => a.type === "rollDice") ?? acts.find((a) => a.type === "endTurn") ?? acts[0]!;
          peer.room.send(MSG.action, action);
        }
        await waitFor(() => (peers[0].games.length > before ? true : undefined));
        state = peers[0].games.at(-1)!;
      }
      // By now the bots have played through; verify nothing a human sent was ever applied for seat 3.
      expect(state.players[3]!.name).toBe("Bot Ada");
      const errorsBefore = peers[1].errors.length;
      peers[1].room.send(MSG.action, { type: "rollDice" }); // not Grace's turn
      const err = await waitFor(() => (peers[1].errors.length > errorsBefore ? peers[1].errors.at(-1) : undefined));
      expect(err.message).toBeTruthy();
    });

    it("bots idle when it is a human's turn (no duplicate bot loop)", async () => {
      const peers = await fullLobby("IDLE");
      peers[0].room.send(MSG.start, { ruleSetId: "home-large-5" });
      await waitFor(() => peers[0].games[0]);
      // Player 0 (Ada, human) must place first: nothing should happen on its own.
      const count = peers[0].games.length;
      await settle(200);
      expect(peers[0].games.length).toBe(count);
      expect(nextActor(peers[0].games.at(-1)!)).toBe(0);
    });

    it("persists bot seats, their rng and the generated board; a restart resumes with bots continuing", async () => {
      const peers = await fullLobby("RSTB");
      peers[0].room.send(MSG.start, { ruleSetId: "home-large-5" });
      await waitFor(() => peers[0].games[0] && peers[0].ruleSet ? true : undefined);
      const mid = await playSetupOverSockets(peers, "RSTB");

      const record = (await store.load("RSTB"))!;
      expect(record.seats.map((s) => s.kind)).toEqual(["human", "human", "human", "bot", "bot"]);
      expect(record.seats.filter((s) => s.kind === "bot").every((s) => typeof s.botRng === "string")).toBe(true);
      expect(record.ruleSet?.mapgen?.generationVersion).toBe("mapgen-v1");
      expect(record.ruleSet?.board).toEqual(peers[0].ruleSet!.board);
      expect(record.build).toEqual(TEST_BUILD);
      expect(record.game).toEqual(mid);
      const tokens = peers.map((p) => p.seat.seatToken);
      const boardBefore = peers[0].ruleSet!.board;

      await server.shutdown();
      server = await bootServer(store);

      const back = await connect("RSTB", "Ada", tokens[0]);
      await waitFor(() => back.games[0] && back.ruleSet ? true : undefined);
      expect(back.seat.playerId).toBe(0);
      expect(back.ruleSet!.board).toEqual(boardBefore); // never regenerated
      expect(back.games[0]).toEqual(mid);
      const snap = await waitFor(() => back.snapshots.at(-1));
      expect(snap.seats.map((s) => s.kind)).toEqual(["human", "human", "human", "bot", "bot"]);
      expect(snap.seats.filter((s) => s.kind === "bot").every((s) => s.connected)).toBe(true);

      // Play on: Ada rolls, then keep feeding the humans' turns; the bots must
      // take theirs on the restarted server, exactly once each.
      let state = back.games.at(-1)!;
      let botMoves = 0;
      let guard = 0;
      const others = [await connect("RSTB", "Grace", tokens[1]), await connect("RSTB", "Alan", tokens[2])];
      await waitFor(() => others.every((o) => o.games.length > 0) ? true : undefined);
      const all = [back, ...others];
      while (guard++ < 40 && botMoves < 2) {
        const actor = nextActor(state)!;
        const peer = all.find((p) => p.seat.playerId === actor);
        const before = back.games.length;
        if (peer) {
          const acts = legalActions(state, back.ruleSet!, actor);
          peer.room.send(MSG.action, acts.find((a) => a.type === "rollDice") ?? acts.find((a) => a.type === "endTurn") ?? acts[0]!);
        } else {
          botMoves++;
        }
        await waitFor(() => (back.games.length > before ? true : undefined));
        state = back.games.at(-1)!;
      }
      expect(botMoves).toBeGreaterThan(0);
      // Every broadcast is a *new* state: a duplicated bot move would either be
      // rejected by the engine (no broadcast) or show up as a repeated state.
      for (let i = 1; i < back.games.length; i++) {
        expect(back.games[i]).not.toEqual(back.games[i - 1]);
      }
    });
  });

  describe("trading with bots (the real-iPad stuck-trade audit)", () => {
    const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
    /** 1 human + 2 bots, C&K, driven to the human's first main turn with tradeable cards. */
    async function humanMainTurn(code: string): Promise<Peer> {
      const host = await connect(code, "Ada", undefined, true);
      host.room.send(MSG.addBot);
      host.room.send(MSG.addBot);
      await waitFor(() => (host.snapshots.at(-1)?.seats.length === 3 ? true : undefined));
      host.room.send(MSG.start, { ruleSetId: "cities-and-knights" });
      await waitFor(() => (host.games[0] && host.ruleSet ? true : undefined));
      const latest = () => host.games.at(-1)!;
      let guard = 0;
      // Setup, then roll: keep feeding Ada's moves (bots move on their own) until Ada's main turn.
      while (!(latest().turn.phase === "mainTurn" && latest().turn.current === 0)) {
        if (guard++ > 400) throw new Error("never reached Ada's main turn");
        const state = latest();
        const actor = nextActor(state)!;
        const before = host.games.length;
        if (actor === 0) {
          const acts = legalActions(state, host.ruleSet!, 0);
          host.room.send(MSG.action, acts.find((a) => a.type === "rollDice") ?? acts.find((a) => a.type === "discardCards") ?? acts[0]!);
        }
        await waitFor(() => (host.games.length > before ? true : undefined));
      }
      return host;
    }

    it("a human offer to a bot is declined by the bot itself (deterministically) and play continues; the applied action is broadcast", async () => {
      const host = await humanMainTurn("TBOT");
      const state = host.games.at(-1)!;
      const me = state.players[0]!;
      const give = (Object.keys(me.resources) as (keyof typeof me.resources)[]).find((r) => me.resources[r] > 0);
      const before = host.games.length;
      const offer = { fromPlayerId: 0, toPlayerId: 1, give: give ? { [give]: 1 } : {}, receive: { ore: 1 } };
      // Even an offer of "nothing" for something (if Ada is broke) is rejected by the engine, never left pending.
      host.room.send(MSG.action, { type: "proposeTrade", offer });
      if (!give) {
        const err = await waitFor(() => host.errors.at(-1));
        expect(err.message).toMatch(/offer something/);
        return;
      }
      // Pending → the bot answers on its own → cleared, without any human input.
      await waitFor(() => (host.games.length >= before + 2 ? true : undefined));
      const seen = host.games.slice(before);
      expect(seen[0]!.pendingTrade).toEqual(offer);
      expect(seen[1]!.pendingTrade).toBeUndefined();
      expect(nextActor(seen[1]!)).toBe(0);
      expect(seen[1]!.players[0]!.resources).toEqual(seen[0]!.players[0]!.resources); // declined, nothing moved
      const bot = chooseAction(seen[0]!, host.ruleSet!, 1, "any-rng");
      expect(bot.action).toEqual({ type: "respondTrade", accept: false });
      expect(host.actions.at(-1)).toEqual({ playerId: 1, action: { type: "respondTrade", accept: false } });
      // The human is not stuck: end turn is legal and accepted.
      const after = host.games.length;
      host.room.send(MSG.action, { type: "endTurn" });
      await waitFor(() => (host.games.length > after ? true : undefined));
      expect(host.games.at(-1)!.turn.current).not.toBe(0);
    });

    it("a server restart with a human→bot offer on the table: the bot answers once on rejoin, nothing is duplicated", async () => {
      // Build the pending trade directly in the store (a mid-offer snapshot), then boot into it.
      const host = await humanMainTurn("TRST");
      const state = host.games.at(-1)!;
      const me = state.players[0]!;
      const give = (Object.keys(me.resources) as (keyof typeof me.resources)[]).find((r) => me.resources[r] > 0);
      if (!give) return; // this seed left Ada broke; the previous test covers the engine's rejection
      const token = host.seat.seatToken;
      const offer = { fromPlayerId: 0, toPlayerId: 1, give: { [give]: 1 }, receive: { ore: 1 } };

      await server.shutdown(); // (the room persists on the way down — inject the offer after that)
      const record = (await store.load("TRST"))!;
      await store.save({ ...record, game: { ...record.game!, pendingTrade: offer } });
      server = await bootServer(store);
      const back = await connect("TRST", "Ada", token);
      await waitFor(() => (back.games.length >= 2 ? true : undefined));
      expect(back.games[0]!.pendingTrade).toEqual(offer);
      expect(back.games[1]!.pendingTrade).toBeUndefined();
      expect(back.actions.filter((a) => a.action.type === "respondTrade")).toHaveLength(1);
      await settle(150);
      expect(back.games.length).toBe(2); // exactly one bot move: the decline
      expect(nextActor(back.games.at(-1)!)).toBe(0);
    });
  });

  describe("bot pacing over the wire", () => {
    it("a bot's turn is spread out: pause → roll → dice linger → actions → end turn, all from one timer", async () => {
      // Reboot with real (scaled-down) pacing; the file-level server runs bots instantly.
      const pacing = { beforeRollMs: 300, afterRollMs: 450, betweenActionsMs: 150, beforeEndTurnMs: 200, responseMs: 100 };
      await server.shutdown();
      server = await bootServer(store, pacing);
      try {
        const peer = await connect("PACE", "Ada", undefined, true);
        const host = peer.room;
        const games = peer.games;
        const stamps: { t: number; env: ActionEnvelope }[] = [];
        host.onMessage(EVT.action, (env: ActionEnvelope) => stamps.push({ t: Date.now(), env }));
        host.send(MSG.addBot);
        host.send(MSG.addBot);
        await waitFor(() => (peer.snapshots.at(-1)?.seats.length === 3 ? true : undefined));
        host.send(MSG.start, { ruleSetId: "base" });
        await waitFor(() => (games[0] && peer.ruleSet ? true : undefined));
        const ruleSet = peer.ruleSet;

        // Feed Ada's moves (first legal placement, roll, end turn) until two full bot turns have gone by.
        const latest = () => games.at(-1)!;
        let botRolls = 0;
        let guard = 0;
        while (botRolls < 2 && guard++ < 200) {
          const state = latest();
          const before = games.length;
          if (nextActor(state) === 0) {
            const acts = legalActions(state, ruleSet!, 0);
            host.send(MSG.action, acts.find((a) => a.type === "rollDice") ?? acts.find((a) => a.type === "endTurn") ?? acts[0]!);
          }
          await waitFor(() => (games.length > before ? true : undefined), 5000);
          botRolls = stamps.filter((s) => s.env.playerId !== 0 && s.env.action.type === "rollDice").length;
        }
        const gapBefore = (i: number) => stamps[i]!.t - stamps[i - 1]!.t;
        for (let i = 1; i < stamps.length; i++) {
          const { env } = stamps[i]!;
          if (env.playerId === 0) continue;
          const prev = stamps[i - 1]!.env;
          const sameBot = prev.playerId === env.playerId;
          if (env.action.type === "rollDice") expect(gapBefore(i)).toBeGreaterThanOrEqual(pacing.beforeRollMs - 20);
          else if (env.action.type === "endTurn" && sameBot && prev.action.type === "rollDice") expect(gapBefore(i)).toBeGreaterThanOrEqual(pacing.afterRollMs + pacing.beforeEndTurnMs - 20);
          else if (sameBot && prev.action.type === "rollDice") expect(gapBefore(i)).toBeGreaterThanOrEqual(pacing.afterRollMs - 20);
          else if (env.action.type !== "endTurn" && !["discardCards", "respondTrade"].includes(env.action.type)) expect(gapBefore(i)).toBeGreaterThanOrEqual(pacing.betweenActionsMs - 20);
        }
        expect(botRolls).toBe(2);
        // The dice shown after each bot roll are the engine's (seeded) — every state is new, none repeated.
        for (let i = 1; i < games.length; i++) expect(games[i]).not.toEqual(games[i - 1]);
        await host.leave();
      } finally {
        await server.shutdown();
        server = await bootServer(store);
      }
    });
  });

  describe("seat recovery (the real Wi-Fi night bug)", () => {
    it("after start: name alone is refused, a wrong token is refused, a bot's token is refused", async () => {
      const [host, guest] = await startedGame("RCLM");
      await guest.room.leave();
      await waitFor(() => (host.snapshots.at(-1)?.seats[1]?.connected === false ? true : undefined));

      // Same display name, no token — the situation on game night.
      await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "RCLM", name: "Grace" })).rejects.toThrow(/already started/);
      // A made-up token.
      await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "RCLM", name: "Grace", seatToken: "not-a-real-token" })).rejects.toThrow(/already started/);
      // A bot's token: bots are not reclaimable. (Fresh room with a bot.)
      const h2 = await connect("RCLB", "Ada", undefined, true);
      await connect("RCLB", "Grace");
      h2.room.send(MSG.addBot);
      await waitFor(() => (h2.snapshots.at(-1)?.seats.length === 3 ? true : undefined));
      h2.room.send(MSG.start, { ruleSetId: "home-large-5" });
      await waitFor(() => h2.games[0]);
      const botToken = (await store.load("RCLB"))!.seats.find((s) => s.kind === "bot")!.token;
      await expect(server.sdk.joinOrCreate(ROOM_NAME, { code: "RCLB", name: "Bot Ada", seatToken: botToken })).rejects.toThrow(/already started/);
      // The seat is still free for its rightful token, and it lands on *its* seat, with a new display name.
      const back = await connect("RCLM", "Grace on her phone", guest.seat.seatToken);
      expect(back.seat.playerId).toBe(1);
      await waitFor(() => back.games[0]);
      expect(back.games[0]).toEqual(latestGame(host));
      const snap = await waitFor(() => host.snapshots.at(-1));
      expect(snap.seats[1]?.name).toBe("Grace on her phone");
      expect(snap.seats[1]?.connected).toBe(true);
    });

    it("a token can only ever land on its own seat", async () => {
      const [host, guest] = await startedGame("OWNS");
      // Host's token, presented from a new connection, gets seat 0 — never seat 1.
      const twin = await connect("OWNS", "Whoever", host.seat.seatToken);
      expect(twin.seat.playerId).toBe(0);
      expect(twin.seat.seatToken).toBe(host.seat.seatToken);
      // The old connection was superseded (it gets no further snapshots);
      // the twin sees itself in seat 0 and the guest untouched in seat 1.
      const snap = await waitFor(() => {
        const s = twin.snapshots.at(-1);
        return s?.seats[0]?.name === "Whoever" ? s : undefined;
      });
      expect(snap.seats.map((s) => s.name)).toEqual(["Whoever", "Grace"]);
      expect(snap.seats[1]?.playerId).toBe(1);
      void guest;
    });
  });

  describe("Cities & Knights slice 3 over the wire", () => {
    it("a room saved mid progress-card discard rehydrates, the pending player reclaims and resolves it, play resumes", async () => {
      // Build the record the way a server would have saved it: seats with
      // tokens, the C&K rule set, and a game paused on a progress discard.
      const { ruleSet, state: rng } = createRuleSet("cities-and-knights", { seed: "mid-decision" });
      let game = createInitialState(ruleSet, { playerNames: ["Ada", "Grace"], rngState: rng });
      game = {
        ...game,
        dice: [3, 3],
        turn: { current: 0, phase: "progressDiscard" },
        pendingProgressDiscards: [1],
        players: game.players.map((p) =>
          p.id === 1 ? { ...p, progressCards: ["bishop", "warlord", "spy", "mining", "inventor"] } : p
        ),
      };
      await store.save({
        code: "MIDP",
        seats: [
          { playerId: 0, name: "Ada", connected: false, isHost: true, kind: "human", token: "tok-ada" },
          { playerId: 1, name: "Grace", connected: false, isHost: false, kind: "human", token: "tok-grace" },
        ],
        ruleSet,
        game,
        build: TEST_BUILD,
        createdAt: 1,
        updatedAt: 1,
      });

      const grace = await connect("MIDP", "Grace", "tok-grace");
      await waitFor(() => grace.games[0] && grace.ruleSet ? true : undefined);
      expect(grace.seat.playerId).toBe(1);
      expect(grace.games[0]!.turn.phase).toBe("progressDiscard");
      expect(grace.games[0]!.players[1]!.progressCards).toHaveLength(5);
      expect(grace.ruleSet!.citiesAndKnights?.progressCards.length).toBeGreaterThan(0);

      const choices = legalActions(grace.games[0]!, grace.ruleSet!, 1).filter((a) => a.type === "discardProgressCard");
      expect(choices).toHaveLength(5);
      // Ada (not pending) cannot resolve it.
      const ada = await connect("MIDP", "Ada", "tok-ada");
      await waitFor(() => ada.games[0]);
      ada.room.send(MSG.action, { type: "discardProgressCard", cardId: "bishop" });
      const err = await waitFor(() => ada.errors[0]);
      expect(err.message).toMatch(/does not owe/);

      grace.room.send(MSG.action, choices[0]!);
      const resumed = await waitFor(() => (grace.games.length >= 2 ? grace.games.at(-1) : undefined));
      expect(resumed.players[1]!.progressCards).toHaveLength(4);
      expect(resumed.pendingProgressDiscards).toBeUndefined();
      expect(resumed.turn.phase).toBe("mainTurn"); // the stashed 6 resolved
      const saved = await store.load("MIDP");
      expect(saved?.game).toEqual(resumed);
    });
  });

  it("a room saved mid-response rehydrates; only the responder can answer; the effect applies once", async () => {
    const { ruleSet, state: rng } = createRuleSet("cities-and-knights", { seed: "mid-response" });
    let game = createInitialState(ruleSet, { playerNames: ["Ada", "Grace"], rngState: rng });
    game = { ...game, turn: { current: 0, phase: "mainTurn" }, players: game.players.map((p) => (p.id === 1 ? { ...p, resources: { ...p.resources, wood: 2 } } : p)) };
    game = startInteraction(game, { kind: "wedding", sourcePlayerId: 0, sourceCardId: "wedding", responders: [1], payload: undefined });
    await store.save({
      code: "MIDR",
      seats: [
        { playerId: 0, name: "Ada", connected: false, isHost: true, kind: "human", token: "tok-ada" },
        { playerId: 1, name: "Grace", connected: false, isHost: false, kind: "human", token: "tok-grace" },
      ],
      ruleSet, game, build: TEST_BUILD, createdAt: 1, updatedAt: 1,
    });
    const grace = await connect("MIDR", "Grace", "tok-grace");
    const ada = await connect("MIDR", "Ada", "tok-ada");
    await waitFor(() => grace.games[0] && ada.games[0] && grace.ruleSet ? true : undefined);
    expect(grace.games[0]!.turn.phase).toBe("respond");
    expect(grace.games[0]!.pendingInteraction?.currentResponder).toBe(1);
    expect(legalActions(grace.games[0]!, grace.ruleSet!, 0)).toEqual([]);
    ada.room.send(MSG.action, { type: "respondInteraction", payload: { cards: { wood: 2 } } });
    const err = await waitFor(() => ada.errors[0]);
    expect(err.message).toMatch(/player 1's response/);
    grace.room.send(MSG.action, { type: "respondInteraction", payload: { cards: { wood: 2 } } });
    const done = await waitFor(() => (grace.games.length >= 2 ? grace.games.at(-1) : undefined));
    expect(done.players[0]!.resources.wood).toBe(2);
    expect(done.players[1]!.resources.wood).toBe(0);
    expect(done.pendingInteraction).toBeUndefined();
    expect(done.turn).toEqual({ current: 0, phase: "mainTurn" });
    expect((await store.load("MIDR"))?.game).toEqual(done);
  });
});
