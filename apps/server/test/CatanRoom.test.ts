// End-to-end room tests: real Colyseus server, real client sockets. Proves
// the server-authority contract — the seat decides who you are, the engine
// decides what's legal, and everyone sees the same state.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import { legalActions } from "@catan/engine";
import {
  CLOSE_SUPERSEDED,
  EVT,
  MSG,
  ROOM_NAME,
  type Action,
  type ErrorPayload,
  type GameState,
  type RoomSnapshot,
  type RuleSet,
  type SeatPayload,
} from "@catan/shared";
import { CatanRoom } from "../src/CatanRoom.js";
import { MemoryStore, type GameStore } from "../src/store.js";

let server: ColyseusTestServer;
// One store for the whole file (the room handler captures it at define
// time); each test starts with it wiped.
const store: GameStore & { clear(): void } = new MemoryStore();

async function bootServer(withStore: GameStore): Promise<ColyseusTestServer> {
  return boot({
    options: {},
    initializeGameServer: (gameServer) => {
      gameServer.define(ROOM_NAME, CatanRoom, { store: withStore }).filterBy(["code"]);
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
  const peer: Partial<Peer> & { snapshots: RoomSnapshot[]; games: GameState[]; errors: ErrorPayload[] } = {
    snapshots: [],
    games: [],
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
});
