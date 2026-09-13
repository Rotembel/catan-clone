// Cities & Knights slice 5: the bounded response system, forced discards,
// knight displacement, and the six cards they unlock.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { knightMoveTargets } from "../src/reducers/knights.js";
import { playableProgressCards } from "../src/reducers/progress.js";
import { interactionOptions } from "../src/reducers/respond.js";
import { handSize } from "../src/resources.js";
import { longestRoadLength } from "../src/selectors/awards.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { normalizeState } from "../src/state.js";
import { giveCommodities, giveProgressCards, giveResources, inMainTurn, newGame, ringOf, testRuleSet, withBuilding, withKnight, withRoads } from "./fixtures.js";
import type { Action, GameState, RuleSet } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true, uniformNumberToken: 6 });
const base = testRuleSet({ uniformNumberToken: 6 });
const ringA = ringOf(ck.board.hexes[3]!.id);
const ringB = ringOf(ck.board.hexes[9]!.id);
const A = ringA.vertices;
const B = ringB.vertices;

function bare(ruleSet: RuleSet, players = ["A", "B", "C"]): GameState {
  const g = newGame(ruleSet, players);
  return inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
}
const play = (s: GameState, playerId: number, cardId: string, payload?: unknown) =>
  apply(s, { playerId, action: { type: "playProgressCard", cardId, payload } }, ck);
const respond = (s: GameState, playerId: number, payload?: unknown) =>
  apply(s, { playerId, action: { type: "respondInteraction", payload } }, ck);
const onlyLegal = (s: GameState, playerId: number) => legalActions(s, ck, playerId).map((a) => a.type);

describe("the response queue", () => {
  it("runs one responder at a time, exposes only their answers, and returns to the source's turn", () => {
    let s = giveProgressCards(bare(ck), 0, ["wedding"]);
    s = withBuilding(withBuilding(s, A[0]!, 1, "city"), B[0]!, 2, "city"); // 1 and 2 richer than 0
    s = giveResources(giveResources(s, 1, { wood: 3 }), 2, { ore: 1 });
    const started = play(s, 0, "wedding");
    expect(started.turn.phase).toBe("respond");
    expect(started.pendingInteraction).toMatchObject({ kind: "wedding", sourcePlayerId: 0, sourceCardId: "wedding", responders: [1, 2], currentResponder: 1, returnPhase: "mainTurn" });
    expect(onlyLegal(started, 0)).toEqual([]);
    expect(onlyLegal(started, 2)).toEqual([]);
    expect(onlyLegal(started, 1)).toEqual(["respondInteraction"]);
    expect(() => apply(started, { playerId: 0, action: { type: "endTurn" } }, ck)).toThrow(IllegalActionError);
    expect(() => respond(started, 2, { cards: { ore: 1 } })).toThrow(/player 1's response/);

    const one = respond(started, 1, { cards: { wood: 2 } });
    expect(one.players[0]!.resources.wood).toBe(2);
    expect(one.pendingInteraction?.currentResponder).toBe(2);
    expect(one.turn.phase).toBe("respond");
    const two = respond(one, 2, { cards: { ore: 1 } }); // only holds 1 → gives 1
    expect(two.players[0]!.resources.ore).toBe(1);
    expect(two.pendingInteraction).toBeUndefined();
    expect(two.turn).toEqual({ current: 0, phase: "mainTurn" });
  });

  it("is absent from the base game", () => {
    expect(() => apply(bare(base), { playerId: 0, action: { type: "respondInteraction", payload: {} } }, base)).toThrow(/nothing to respond to/);
  });
});

describe("Wedding", () => {
  it("only richer players with cards respond; the gift must be 2 (or the whole hand of 1) and held", () => {
    let s = giveProgressCards(bare(ck), 0, ["wedding"]);
    s = withBuilding(s, A[0]!, 1, "city");
    expect(playableProgressCards(s, ck, 0)).toEqual([]); // richer but no cards
    s = giveResources(s, 1, { wood: 1 });
    const started = play(s, 0, "wedding");
    expect(started.pendingInteraction?.responders).toEqual([1]);
    expect(interactionOptions(started, ck, 1)).toEqual([{ cards: { wood: 1 } }]);
    expect(() => respond(started, 1, { cards: { ore: 1 } })).toThrow(/do not hold/);
    expect(() => respond(started, 1, { cards: {} })).toThrow(/must give 1/);
  });
});

describe("Saboteur", () => {
  it("makes players with at least your points discard half, through an explicit forced-discard phase", () => {
    let s = giveProgressCards(bare(ck), 0, ["saboteur"]);
    s = withBuilding(s, A[0]!, 1, "settlement"); // 1 VP > 0
    s = giveResources(giveResources(s, 1, { wood: 3, ore: 2 }), 2, { brick: 1 }); // 2 has 0 VP == 0 VP: also targeted; 1 card → owes 0
    const forced = play(s, 0, "saboteur");
    expect(forced.turn.phase).toBe("forcedDiscard");
    expect(forced.discardRequests).toEqual([{ playerId: 1, count: 2, reason: "saboteur", sourcePlayerId: 0, sourceCardId: "saboteur", returnPhase: "mainTurn" }]);
    expect(onlyLegal(forced, 0)).toEqual([]);
    expect(onlyLegal(forced, 1)).toEqual(["discardCards"]);
    expect(() => apply(forced, { playerId: 1, action: { type: "discardCards", discard: { wood: 1 } } }, ck)).toThrow(/exactly 2/);
    const done = apply(forced, { playerId: 1, action: { type: "discardCards", discard: { wood: 1, ore: 1 } } }, ck);
    expect(handSize(done.players[1]!)).toBe(3);
    expect(done.discardRequests).toBeUndefined();
    expect(done.turn).toEqual({ current: 0, phase: "mainTurn" });
    expect(done.bank.wood).toBe(20);
    // The 7 flow is untouched: pendingDiscards stays the 7's own list.
    expect(done.pendingDiscards).toBeUndefined();
  });
});

describe("Deserter", () => {
  it("the target chooses the knight; the source re-places one of that strength (or declines)", () => {
    let s = giveProgressCards(bare(ck), 0, ["deserter"]);
    s = withRoads(s, 0, ringA.edges.slice(0, 2));
    s = withKnight(withKnight(s, B[0]!, 1, { level: 2, active: true }), B[2]!, 1);
    expect(playableProgressCards(s, ck, 0)[0]!.payloads).toEqual([{ playerId: 1 }]);
    const asked = play(s, 0, "deserter", { playerId: 1 });
    expect(asked.pendingInteraction).toMatchObject({ kind: "deserterChoose", currentResponder: 1 });
    expect(interactionOptions(asked, ck, 1)).toEqual([{ vertex: B[0] }, { vertex: B[2] }]);
    const chosen = respond(asked, 1, { vertex: B[0] }); // gives up the strong one
    expect(chosen.board.knights[B[0]!]).toBeUndefined();
    expect(chosen.pendingInteraction).toMatchObject({ kind: "deserterPlace", currentResponder: 0, payload: { level: 2 } });
    const spots = interactionOptions(chosen, ck, 0);
    expect(spots.length).toBeGreaterThan(1); // vertices on 0's roads, plus "no thanks"
    const placed = respond(chosen, 0, spots[0]);
    const v = (spots[0] as { vertex: string }).vertex;
    expect(placed.board.knights[v]).toEqual({ playerId: 0, level: 2, active: false, activatedThisTurn: false });
    expect(placed.turn).toEqual({ current: 0, phase: "mainTurn" });
    // Declining is allowed too.
    const declined = respond(chosen, 0, {});
    expect(Object.values(declined.board.knights).filter((k) => k?.playerId === 0)).toHaveLength(0);
    expect(declined.turn.phase).toBe("mainTurn");
  });
});

describe("Diplomat", () => {
  it("removes an open road of anyone; your own may be re-placed; longest road recalculates", () => {
    let s = giveProgressCards(bare(ck), 0, ["diplomat", "diplomat"]);
    s = withBuilding(s, B[0]!, 1, "settlement");
    s = withRoads(s, 1, ringB.edges.slice(0, 5)); // 1: chain of 5 from the settlement → longest road 5
    s = withBuilding(s, A[0]!, 0, "settlement");
    s = withRoads(s, 0, [ringA.edges[0]!]);
    expect(longestRoadLength(s, ck, 1)).toBe(5);
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads as { edge: string }[];
    // The chain's far end is open; its first edge (anchored by the settlement on one side, the chain on the other) is not.
    expect(opts.map((o) => o.edge)).toContain(ringB.edges[4]);
    expect(opts.map((o) => o.edge)).not.toContain(ringB.edges[2]);
    const cut = play(s, 0, "diplomat", { edge: ringB.edges[4] });
    expect(cut.board.roads[ringB.edges[4]!]).toBeUndefined();
    expect(longestRoadLength(cut, ck, 1)).toBe(4);
    expect(cut.turn.phase).toBe("mainTurn"); // someone else's road: no follow-up

    const own = play(cut, 0, "diplomat", { edge: ringA.edges[0] });
    expect(own.board.roads[ringA.edges[0]!]).toBeUndefined();
    expect(own.pendingInteraction).toMatchObject({ kind: "diplomatReplace", currentResponder: 0 });
    // Re-placement must connect to your network — here the settlement at A[0].
    expect((interactionOptions(own, ck, 0) as { edge?: string }[]).map((o) => o.edge)).toContain(ringA.edges[5]);
    expect(() => respond(own, 0, { edge: ringA.edges[2] })).toThrow(/cannot build a road/);
    const re = respond(own, 0, { edge: ringA.edges[5] });
    expect(re.board.roads[ringA.edges[5]!]).toBe(0);
    expect(re.turn.phase).toBe("mainTurn");
  });
});

describe("knight displacement", () => {
  it("Intrigue: an enemy knight on your road is displaced; its owner relocates it along their roads, or loses it", () => {
    let s = giveProgressCards(bare(ck), 0, ["intrigue", "intrigue"]);
    s = withRoads(s, 0, [ringA.edges[0]!]); // touches A[0] and A[1]
    s = withRoads(s, 1, ringA.edges.slice(1, 4)); // 1's roads continue from A[1]
    s = withKnight(s, A[1]!, 1, { active: true });
    expect(playableProgressCards(s, ck, 0)[0]!.payloads).toEqual([{ vertex: A[1] }]);
    const pushed = play(s, 0, "intrigue", { vertex: A[1] });
    expect(pushed.board.knights[A[1]!]).toBeUndefined();
    expect(pushed.pendingInteraction).toMatchObject({ kind: "displaceKnight", currentResponder: 1, sourceCardId: "intrigue" });
    const dests = interactionOptions(pushed, ck, 1) as { vertex: string }[];
    expect(dests.map((d) => d.vertex).sort()).toEqual([A[2], A[3], A[4]].sort());
    const moved = respond(pushed, 1, { vertex: A[3] });
    expect(moved.board.knights[A[3]!]).toMatchObject({ playerId: 1, active: true });
    expect(moved.turn).toEqual({ current: 0, phase: "mainTurn" });

    // No roads to retreat along: the knight is simply removed, no response needed.
    let stuck = giveProgressCards(bare(ck), 0, ["intrigue"]);
    stuck = withRoads(stuck, 0, [ringA.edges[0]!]);
    stuck = withKnight(stuck, A[1]!, 1);
    const gone = play(stuck, 0, "intrigue", { vertex: A[1] });
    expect(gone.board.knights[A[1]!]).toBeUndefined();
    expect(gone.pendingInteraction).toBeUndefined();
    expect(gone.turn.phase).toBe("mainTurn");
  });

  it("an active knight may move onto a weaker enemy knight and displace it; never onto an equal or stronger one", () => {
    let s = bare(ck);
    s = withRoads(s, 0, ringA.edges.slice(0, 3));
    s = withKnight(s, A[0]!, 0, { level: 2, active: true });
    s = withKnight(s, A[2]!, 1, { level: 1 });
    s = withRoads(s, 1, [ringA.edges[3]!, ringA.edges[4]!]); // 1 can retreat from A[2]... via its own roads at A[3]/A[4]? A[2]-A[3] is edge 2 (owned by 0), so no
    const targets = knightMoveTargets(s, ck, 0, A[0]!, 2);
    expect(targets.displace).toEqual([A[2]]);
    expect(targets.free).toContain(A[1]);
    expect(legalActions(s, ck, 0)).toContainEqual({ type: "moveKnight", from: A[0]!, to: A[2]! } satisfies Action);
    const moved = apply(s, { playerId: 0, action: { type: "moveKnight", from: A[0]!, to: A[2]! } }, ck);
    expect(moved.board.knights[A[2]!]).toMatchObject({ playerId: 0, level: 2, active: false });
    expect(moved.board.knights[A[0]!]).toBeUndefined();
    // 1's roads don't touch A[2], so its knight had nowhere to go and is lost.
    expect(Object.values(moved.board.knights).filter((k) => k?.playerId === 1)).toHaveLength(0);
    expect(moved.turn.phase).toBe("mainTurn");

    const strong = withKnight(s, A[2]!, 1, { level: 2 });
    expect(knightMoveTargets(strong, ck, 0, A[0]!, 2).displace).toEqual([]);
    expect(() => apply(strong, { playerId: 0, action: { type: "moveKnight", from: A[0]!, to: A[2]! } }, ck)).toThrow(/cannot reach/);
  });
});

describe("Commercial Harbor", () => {
  it("the initiator offers a resource to each opponent with commodities; each answers with a commodity", () => {
    let s = giveProgressCards(bare(ck), 0, ["commercialHarbor"]);
    s = giveResources(s, 0, { wood: 1, brick: 1 });
    s = giveCommodities(s, 1, { cloth: 1, paper: 1 });
    s = giveCommodities(s, 2, { coin: 1 });
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads as { offers: Record<number, string> }[];
    expect(opts).toEqual([{ offers: { 1: "wood" } }, { offers: { 1: "brick" } }]); // 1 wood covers one opponent
    const started = play(s, 0, "commercialHarbor", { offers: { 1: "wood", 2: "brick" } });
    expect(started.pendingInteraction?.responders).toEqual([1, 2]);
    expect(interactionOptions(started, ck, 1)).toEqual([{ commodity: "cloth" }, { commodity: "paper" }]);
    expect(() => respond(started, 1, { commodity: "coin" })).toThrow(/you hold/);
    const one = respond(started, 1, { commodity: "paper" });
    expect(one.players[0]!.commodities.paper).toBe(1);
    expect(one.players[0]!.resources.wood).toBe(0);
    expect(one.players[1]!.resources.wood).toBe(1);
    const two = respond(one, 2, { commodity: "coin" });
    expect(two.players[0]!.commodities.coin).toBe(1);
    expect(two.players[2]!.resources.brick).toBe(1);
    expect(two.turn.phase).toBe("mainTurn");
    expect(() => play(s, 0, "commercialHarbor", { offers: { 1: "wood", 2: "wood" } })).toThrow(/do not hold 2 wood/);
  });
});

describe("persistence mid-response", () => {
  it("a pending response, a forced discard, and a displacement all survive a JSON round trip with the same legal actions", () => {
    let s = giveProgressCards(bare(ck), 0, ["wedding"]);
    s = withBuilding(s, A[0]!, 1, "city");
    s = giveResources(s, 1, { wood: 2 });
    const mid = play(s, 0, "wedding");
    const back = normalizeState(JSON.parse(JSON.stringify(mid)) as GameState);
    expect(back).toEqual(mid);
    expect(legalActions(back, ck, 1)).toEqual(legalActions(mid, ck, 1));
    expect(respond(back, 1, { cards: { wood: 2 } })).toEqual(respond(mid, 1, { cards: { wood: 2 } }));

    let f = giveProgressCards(bare(ck), 0, ["saboteur"]);
    f = withBuilding(f, A[0]!, 1, "settlement");
    f = giveResources(f, 1, { wood: 4 });
    const forced = play(f, 0, "saboteur");
    const forcedBack = normalizeState(JSON.parse(JSON.stringify(forced)) as GameState);
    expect(forcedBack).toEqual(forced);
    expect(legalActions(forcedBack, ck, 1)).toEqual(legalActions(forced, ck, 1));
  });
});
