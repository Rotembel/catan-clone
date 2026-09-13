// Cities & Knights slice 2: knights as board pieces.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { getGeometry } from "../src/geometryCache.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { knightReachableVertices, legalKnightVertices } from "../src/reducers/knights.js";
import { longestRoadLength } from "../src/selectors/awards.js";
import { legalRoadEdges, legalSettlementVertices } from "../src/selectors/building.js";
import { legalActions } from "../src/selectors/legalActions.js";
import {
  giveResources,
  inMainTurn,
  newGame,
  ringOf,
  testRuleSet,
  withBuilding,
  withImprovement,
  withKnight,
  withRoads,
} from "./fixtures.js";
import type { GameState } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true });
const hex = ck.board.hexes[3]!.id;
const { edges, vertices } = ringOf(hex);

/** Player 0 owns a road ring around one hex; empty board otherwise; main turn. */
function ringGame(): GameState {
  const g = newGame(ck);
  let s: GameState = { ...g, board: { ...g.board, buildings: {}, roads: {} } };
  s = withRoads(s, 0, edges);
  return inMainTurn(s);
}

describe("building a knight", () => {
  it("costs sheep + ore, must touch your road on an empty vertex, and is placed inactive at level 1", () => {
    let s = giveResources(ringGame(), 0, { sheep: 1, ore: 1 });
    expect(legalKnightVertices(s, ck, 0).sort()).toEqual([...vertices].sort());
    expect(legalActions(s, ck, 0).filter((a) => a.type === "buildKnight")).toHaveLength(6);

    const after = apply(s, { playerId: 0, action: { type: "buildKnight", vertex: vertices[0]! } }, ck);
    expect(after.board.knights[vertices[0]!]).toEqual({ playerId: 0, level: 1, active: false, activatedThisTurn: false });
    expect(after.players[0]!.resources.sheep).toBe(0);
    expect(after.players[0]!.resources.ore).toBe(0);
    expect(after.bank.sheep).toBe(20);

    // Not affordable, not on your road, or occupied: refused.
    expect(() => apply(after, { playerId: 0, action: { type: "buildKnight", vertex: vertices[1]! } }, ck)).toThrow(/afford/);
    const rich = giveResources(after, 0, { sheep: 5, ore: 5 });
    const off = ringOf(ck.board.hexes[9]!.id).vertices[0]!;
    expect(() => apply(rich, { playerId: 0, action: { type: "buildKnight", vertex: off } }, ck)).toThrow(/next to one of your roads/);
    expect(() => apply(rich, { playerId: 0, action: { type: "buildKnight", vertex: vertices[0]! } }, ck)).toThrow(/next to one of your roads/);
  });

  it("is limited to two basic knights", () => {
    let s = giveResources(ringGame(), 0, { sheep: 3, ore: 3 });
    s = apply(s, { playerId: 0, action: { type: "buildKnight", vertex: vertices[0]! } }, ck);
    s = apply(s, { playerId: 0, action: { type: "buildKnight", vertex: vertices[2]! } }, ck);
    expect(() => apply(s, { playerId: 0, action: { type: "buildKnight", vertex: vertices[4]! } }, ck)).toThrow(/no basic knights left/);
    expect(legalActions(s, ck, 0).some((a) => a.type === "buildKnight")).toBe(false);
  });
});

describe("activating a knight", () => {
  it("costs wheat, makes it active, and blocks moving in the same turn", () => {
    let s = withKnight(ringGame(), vertices[0]!, 0);
    expect(() => apply(s, { playerId: 0, action: { type: "activateKnight", vertex: vertices[0]! } }, ck)).toThrow(/afford/);
    s = giveResources(s, 0, { wheat: 1 });
    const on = apply(s, { playerId: 0, action: { type: "activateKnight", vertex: vertices[0]! } }, ck);
    expect(on.board.knights[vertices[0]!]).toMatchObject({ active: true, activatedThisTurn: true });
    expect(on.players[0]!.resources.wheat).toBe(0);
    expect(() => apply(on, { playerId: 0, action: { type: "activateKnight", vertex: vertices[0]! } }, ck)).toThrow(/already active/);
    expect(() => apply(on, { playerId: 0, action: { type: "moveKnight", from: vertices[0]!, to: vertices[1]! } }, ck)).toThrow(/turn it was activated/);
    expect(legalActions(on, ck, 0).some((a) => a.type === "moveKnight")).toBe(false);

    // Next turn the restriction lapses (and the knight is still active).
    const ended = apply(on, { playerId: 0, action: { type: "endTurn" } }, ck);
    expect(ended.board.knights[vertices[0]!]).toMatchObject({ active: true, activatedThisTurn: false });
  });

  it("only your own knight", () => {
    let s = withKnight(ringGame(), vertices[0]!, 1);
    s = giveResources(s, 0, { wheat: 1 });
    expect(() => apply(s, { playerId: 0, action: { type: "activateKnight", vertex: vertices[0]! } }, ck)).toThrow(/no knight at/);
  });
});

describe("promoting a knight", () => {
  it("costs sheep + ore per level, needs the Fortress for level 3, respects per-level limits", () => {
    let s = withKnight(ringGame(), vertices[0]!, 0, { active: true });
    s = giveResources(s, 0, { sheep: 2, ore: 2 });
    const strong = apply(s, { playerId: 0, action: { type: "promoteKnight", vertex: vertices[0]! } }, ck);
    expect(strong.board.knights[vertices[0]!]).toMatchObject({ level: 2, active: true });

    expect(() => apply(strong, { playerId: 0, action: { type: "promoteKnight", vertex: vertices[0]! } }, ck)).toThrow(/Fortress/);
    expect(legalActions(strong, ck, 0).some((a) => a.type === "promoteKnight")).toBe(false);

    const fortified = withImprovement(strong, 0, "politics", 3);
    const mighty = apply(fortified, { playerId: 0, action: { type: "promoteKnight", vertex: vertices[0]! } }, ck);
    expect(mighty.board.knights[vertices[0]!]!.level).toBe(3);
    expect(() => apply(giveResources(mighty, 0, { sheep: 1, ore: 1 }), { playerId: 0, action: { type: "promoteKnight", vertex: vertices[0]! } }, ck)).toThrow(/mighty/);

    // Two strong knights already -> a third can't be promoted to strong.
    let full = withKnight(withKnight(withKnight(ringGame(), vertices[0]!, 0, { level: 2 }), vertices[2]!, 0, { level: 2 }), vertices[4]!, 0);
    full = giveResources(full, 0, { sheep: 1, ore: 1 });
    expect(() => apply(full, { playerId: 0, action: { type: "promoteKnight", vertex: vertices[4]! } }, ck)).toThrow(/no level-2 knights left/);
  });
});

describe("moving a knight", () => {
  it("goes along your own roads to an empty vertex and deactivates the knight", () => {
    const s = withKnight(ringGame(), vertices[0]!, 0, { active: true });
    // Around the ring every other vertex is reachable.
    expect(knightReachableVertices(s, ck, 0, vertices[0]!).sort()).toEqual(vertices.slice(1).sort());
    const moved = apply(s, { playerId: 0, action: { type: "moveKnight", from: vertices[0]!, to: vertices[3]! } }, ck);
    expect(moved.board.knights[vertices[0]!]).toBeUndefined();
    expect(moved.board.knights[vertices[3]!]).toMatchObject({ playerId: 0, level: 1, active: false });
  });

  it("inactive knights can't move, and an opponent's piece blocks the way", () => {
    const idle = withKnight(ringGame(), vertices[0]!, 0);
    expect(() => apply(idle, { playerId: 0, action: { type: "moveKnight", from: vertices[0]!, to: vertices[1]! } }, ck)).toThrow(/active knight/);

    // Opponent settlement at vertex 1 and knight at vertex 5: vertex 0 can
    // only step to... neither neighbour; the ring is cut on both sides.
    let cut = withKnight(ringGame(), vertices[0]!, 0, { active: true });
    cut = withBuilding(cut, vertices[1]!, 1, "settlement");
    cut = withKnight(cut, vertices[5]!, 1, { level: 3 });
    expect(knightReachableVertices(cut, ck, 0, vertices[0]!)).toEqual([]);
    expect(() => apply(cut, { playerId: 0, action: { type: "moveKnight", from: vertices[0]!, to: vertices[2]! } }, ck)).toThrow(/cannot reach/);

    // Your own pieces are passable.
    let own = withKnight(ringGame(), vertices[0]!, 0, { active: true });
    own = withBuilding(own, vertices[1]!, 0, "settlement");
    expect(knightReachableVertices(own, ck, 0, vertices[0]!)).toContain(vertices[2]!);
  });

  it("needs a road: a knight with no roads under it goes nowhere", () => {
    const g = newGame(ck);
    let s: GameState = inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
    s = withKnight(s, vertices[0]!, 0, { active: true });
    expect(knightReachableVertices(s, ck, 0, vertices[0]!)).toEqual([]);
  });
});

describe("knights on the board interact with building", () => {
  it("a knight occupies its vertex: no settlement there, but the distance rule ignores it", () => {
    const geometry = getGeometry(ck.board);
    let s = giveResources(ringGame(), 0, { wood: 9, brick: 9, sheep: 9, wheat: 9 });
    s = withKnight(s, vertices[0]!, 1);
    const legal = legalSettlementVertices(s, ck, 0, { requireRoadConnection: true });
    expect(legal).not.toContain(vertices[0]!);
    // Its neighbours are still fine (a knight is not a building).
    for (const n of geometry.vertexNeighbors.get(vertices[0]!) ?? []) {
      if (vertices.includes(n)) expect(legal).toContain(n);
    }
  });

  it("an opponent's knight breaks your longest road and stops you building past it", () => {
    // A closed ring is a poor probe: a path may start and end *at* the
    // blocked vertex, so a 6-ring still scores 6 (as with an enemy
    // settlement). Use an open chain of 5 with the knight in the middle.
    const g = newGame(ck);
    let chain: GameState = inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
    const geometry = getGeometry(ck.board);
    const edgeBetween = (a: string, b: string) =>
      [...geometry.edgeVertices.entries()].find(([, vs]) => vs.includes(a) && vs.includes(b))![0];
    const chainEdges = [1, 2, 3, 4, 5].map((i) => edgeBetween(vertices[i]!, vertices[(i + 1) % 6]!));
    chain = withRoads(chain, 0, chainEdges); // v1-v2-v3-v4-v5-v0
    expect(longestRoadLength(chain, ck, 0)).toBe(5);

    const blocked = withKnight(chain, vertices[3]!, 1);
    expect(longestRoadLength(blocked, ck, 0)).toBe(3); // v3-v4-v5-v0 on one side, v1-v2-v3 on the other

    // Player 0 can't extend past the knight: edges that touch v3 only via
    // the knight's vertex are off the menu.
    const throughV3 = [...geometry.vertexEdges.get(vertices[3]!)!].filter((e) => !chainEdges.includes(e));
    for (const e of throughV3) expect(legalRoadEdges(blocked, ck, 0)).not.toContain(e);

    // Your own knight there is no obstacle.
    const mine = withKnight(chain, vertices[3]!, 0);
    expect(longestRoadLength(mine, ck, 0)).toBe(5);
    for (const e of throughV3) expect(legalRoadEdges(mine, ck, 0)).toContain(e);
  });
});
