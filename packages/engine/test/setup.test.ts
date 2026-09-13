// Opening placement: snake order, the distance rule, and the second
// settlement's payout.

import { describe, expect, it } from "vitest";
import { apply, IllegalActionError } from "../src/apply.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { totalCards } from "../src/resources.js";
import { getGeometry } from "../src/geometryCache.js";
import { newGame, playSetup, testRuleSet } from "./fixtures.js";

describe("setup phase", () => {
  const ruleSet = testRuleSet();

  it("runs settlement -> road in snake order and ends at the first player's roll", () => {
    const state = newGame(ruleSet, ["Ada", "Grace", "Alan"]);
    expect(state.turn).toEqual({ current: 0, phase: "setupSettlement1" });

    const done = playSetup(state, ruleSet);
    expect(done.turn).toEqual({ current: 0, phase: "rollDice" });

    // Each player placed exactly 2 settlements and 2 roads.
    for (const player of done.players) {
      const settlements = Object.values(done.board.buildings).filter(
        (b) => b?.playerId === player.id
      );
      const roads = Object.values(done.board.roads).filter((owner) => owner === player.id);
      expect(settlements).toHaveLength(2);
      expect(roads).toHaveLength(2);
    }
  });

  it("gives every player starting resources from their second settlement", () => {
    const done = playSetup(newGame(ruleSet, ["Ada", "Grace", "Alan"]), ruleSet);
    for (const player of done.players) {
      expect(totalCards(player.resources)).toBeGreaterThan(0);
    }
  });

  it("enforces the distance rule", () => {
    const state = newGame(ruleSet);
    const first = legalActions(state, ruleSet, 0)[0]!;
    expect(first.type).toBe("buildSettlement");
    const vertex = (first as { type: "buildSettlement"; vertex: string }).vertex;
    const afterFirst = apply(state, { playerId: 0, action: first }, ruleSet);

    const geometry = getGeometry(ruleSet.board);
    const neighbor = (geometry.vertexNeighbors.get(vertex) ?? [])[0]!;

    // The neighbouring vertex is now off limits — to anyone.
    expect(legalActions(afterFirst, ruleSet, 0).map((a) => JSON.stringify(a))).not.toContain(
      JSON.stringify({ type: "buildSettlement", vertex: neighbor })
    );

    const road = legalActions(afterFirst, ruleSet, 0)[0]!;
    const afterRoad = apply(afterFirst, { playerId: 0, action: road }, ruleSet);
    expect(afterRoad.turn).toEqual({ current: 1, phase: "setupSettlement1" });

    expect(() =>
      apply(afterRoad, { playerId: 1, action: { type: "buildSettlement", vertex: neighbor } }, ruleSet)
    ).toThrow(IllegalActionError);
  });

  it("rejects a setup road that doesn't touch the settlement just placed", () => {
    const state = newGame(ruleSet);
    const settle = legalActions(state, ruleSet, 0)[0]!;
    const afterSettle = apply(state, { playerId: 0, action: settle }, ruleSet);

    const geometry = getGeometry(ruleSet.board);
    const connected = new Set(legalActions(afterSettle, ruleSet, 0).map((a) => JSON.stringify(a)));
    const farEdge = [...geometry.edgeVertices.keys()].find(
      (edge) => !connected.has(JSON.stringify({ type: "buildRoad", edge }))
    )!;

    expect(() =>
      apply(afterSettle, { playerId: 0, action: { type: "buildRoad", edge: farEdge } }, ruleSet)
    ).toThrow(IllegalActionError);
  });

  it("rejects actions from a player whose turn it isn't", () => {
    const state = newGame(ruleSet);
    const action = legalActions(state, ruleSet, 0)[0]!;
    expect(() => apply(state, { playerId: 1, action }, ruleSet)).toThrow(IllegalActionError);
  });
});
