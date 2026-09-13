// Opening placement as data (RuleSet.setup): N snake rounds, resource grant
// from a configurable round. The base game and Cities & Knights must come
// out exactly as before.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { setupRulesOf } from "../src/reducers/setup.js";
import { getGeometry } from "../src/geometryCache.js";
import { totalCards } from "../src/resources.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { newGame, playSetup, testRuleSet } from "./fixtures.js";
import type { GameState, RuleSet } from "@catan/shared";

const threeRounds = (): RuleSet => ({
  ...testRuleSet(),
  id: "three",
  setup: {
    sequence: "snake",
    rounds: [
      { piece: "settlement", road: true },
      { piece: "settlement", road: true },
      { piece: "settlement", road: true },
    ],
    startingResourcesRound: 2,
  },
});

/** Drive setup with the first legal action, recording who placed each piece. */
function trace(ruleSet: RuleSet, players: string[]): { state: GameState; placers: number[]; rounds: number[] } {
  let state = newGame(ruleSet, players);
  const placers: number[] = [];
  const rounds: number[] = [];
  let guard = 0;
  while (state.turn.phase.startsWith("setup")) {
    if (guard++ > 200) throw new Error("setup did not finish");
    const playerId = state.players[state.turn.current]!.id;
    const action = legalActions(state, ruleSet, playerId)[0]!;
    if (action.type === "buildSettlement") {
      placers.push(playerId);
      rounds.push(state.setupRound);
    }
    state = apply(state, { playerId, action }, ruleSet);
  }
  return { state, placers, rounds };
}

describe("three-round setup", () => {
  it("snakes 0..N-1, N-1..0, 0..N-1 and ends at player 0's first roll", () => {
    const { state, placers, rounds } = trace(threeRounds(), ["A", "B", "C"]);
    expect(placers).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
    expect(rounds).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(state.turn).toEqual({ current: 0, phase: "rollDice" });
    expect(state.setupRound).toBe(3);
    for (const p of state.players) {
      const mine = Object.values(state.board.buildings).filter((b) => b?.playerId === p.id);
      expect(mine).toHaveLength(3);
      expect(mine.every((b) => b!.kind === "settlement")).toBe(true);
    }
    expect(Object.keys(state.board.roads)).toHaveLength(9);
  });

  /** Producing hexes around a vertex (deserts excluded). */
  const producingCount = (ruleSet: RuleSet, vertex: string): number =>
    (getGeometry(ruleSet.board).vertexHexes.get(vertex) ?? []).filter(
      (h) => ruleSet.board.hexes.find((x) => x.id === h)!.resource !== "desert"
    ).length;

  /** First legal action, except settlements go on the most productive legal vertex. */
  const bestAction = (state: GameState, ruleSet: RuleSet, playerId: number) => {
    const options = legalActions(state, ruleSet, playerId);
    const settlements = options.filter((a): a is Extract<typeof a, { type: "buildSettlement" }> => a.type === "buildSettlement");
    if (settlements.length === 0) return options[0]!;
    return settlements.reduce((best, a) => (producingCount(ruleSet, a.vertex) > producingCount(ruleSet, best.vertex) ? a : best));
  };

  it("pays starting resources exactly once, on round 2, and nothing on round 3", () => {
    const ruleSet = threeRounds();
    let state = newGame(ruleSet, ["A", "B"]);
    const step = () => {
      const playerId = state.players[state.turn.current]!.id;
      state = apply(state, { playerId, action: bestAction(state, ruleSet, playerId) }, ruleSet);
    };
    // Round 1: 2 players × (settlement + road) — nothing yet.
    for (let i = 0; i < 4; i++) step();
    expect(state.setupRound).toBe(1);
    expect(state.players.every((p) => totalCards(p.resources) === 0)).toBe(true);
    // Round 2 (backwards): B places → B has cards, A still none; then A.
    step();
    expect(totalCards(state.players[1]!.resources)).toBeGreaterThan(0);
    expect(totalCards(state.players[0]!.resources)).toBe(0);
    step(); step(); step();
    const afterRound2 = state.players.map((p) => ({ ...p.resources }));
    expect(afterRound2.every((r) => totalCards(r) > 0)).toBe(true);
    // Round 3: four more placements, hands unchanged.
    for (let i = 0; i < 4; i++) step();
    expect(state.turn.phase).toBe("rollDice");
    expect(state.players.map((p) => p.resources)).toEqual(afterRound2);
  });

  it("the grant is exactly one card per adjacent producing hex, deserts give nothing, and the bank balances", () => {
    const ruleSet = threeRounds();
    const geometry = getGeometry(ruleSet.board);
    const desert = ruleSet.board.hexes.find((h) => h.resource === "desert")!;
    const bankBefore = 19 * 5;
    let state = newGame(ruleSet, ["A", "B"]);

    const producingAround = (vertex: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
        const hex = ruleSet.board.hexes.find((h) => h.id === hexId)!;
        if (hex.resource === "desert") continue;
        out[hex.resource] = (out[hex.resource] ?? 0) + 1;
      }
      return out;
    };

    // Drive setup with productive picks, except that in round 2 player A
    // deliberately takes a vertex touching the desert (the most productive
    // such vertex), so the desert's non-contribution is exercised.
    let aRound2Vertex: string | undefined;
    let guard = 0;
    while (state.turn.phase.startsWith("setup") && guard++ < 50) {
      const playerId = state.players[state.turn.current]!.id;
      let action = bestAction(state, ruleSet, playerId);
      if (playerId === 0 && state.setupRound === 1 && action.type === "buildSettlement") {
        const desertSpots = legalActions(state, ruleSet, playerId).filter(
          (a): a is Extract<typeof a, { type: "buildSettlement" }> =>
            a.type === "buildSettlement" && (geometry.vertexHexes.get(a.vertex) ?? []).includes(desert.id)
        );
        expect(desertSpots.length).toBeGreaterThan(0);
        action = desertSpots.reduce((best, a) => (producingCount(ruleSet, a.vertex) > producingCount(ruleSet, best.vertex) ? a : best));
        aRound2Vertex = action.vertex;
      }
      state = apply(state, { playerId, action }, ruleSet);
    }
    expect(aRound2Vertex).toBeDefined();
    const expected = producingAround(aRound2Vertex!);
    const actual = Object.fromEntries(
      Object.entries(state.players[0]!.resources).filter(([, n]) => n > 0)
    );
    expect(actual).toEqual(expected);
    // The desert really was adjacent and really paid nothing.
    expect((geometry.vertexHexes.get(aRound2Vertex!) ?? []).includes(desert.id)).toBe(true);
    expect(totalCards(state.players[0]!.resources)).toBe((geometry.vertexHexes.get(aRound2Vertex!) ?? []).length - 1);

    // Conservation: every card that left the bank is in a hand.
    const inHands = state.players.reduce((n, p) => n + totalCards(p.resources), 0);
    expect(totalCards(state.bank) + inHands).toBe(bankBefore);
  });

  it("uses the legacy phase names, so clients and bots need no new phase", () => {
    const ruleSet = threeRounds();
    let state = newGame(ruleSet, ["A", "B"]);
    expect(state.turn.phase).toBe("setupSettlement1");
    const seen = new Set<string>();
    let guard = 0;
    while (state.turn.phase.startsWith("setup") && guard++ < 100) {
      seen.add(state.turn.phase);
      const playerId = state.players[state.turn.current]!.id;
      state = apply(state, { playerId, action: legalActions(state, ruleSet, playerId)[0]! }, ruleSet);
    }
    expect([...seen].sort()).toEqual(["setupRoad1", "setupRoad2", "setupSettlement1", "setupSettlement2"]);
  });

  it("a round without a road advances straight to the next placement", () => {
    const ruleSet: RuleSet = { ...threeRounds(), setup: { sequence: "snake", rounds: [{ piece: "settlement", road: false }, { piece: "settlement", road: true }], startingResourcesRound: 2 } };
    let state = newGame(ruleSet, ["A", "B"]);
    const p0 = legalActions(state, ruleSet, 0)[0]!;
    state = apply(state, { playerId: 0, action: p0 }, ruleSet);
    expect(state.turn).toEqual({ current: 1, phase: "setupSettlement1" });
    expect(state.setupLastSettlement).toBeUndefined();
    expect(Object.keys(state.board.roads)).toHaveLength(0);
  });
});

describe("derived setup rules (no RuleSet.setup)", () => {
  it("base game: two settlement rounds, grant on the second — unchanged order and grant", () => {
    const ruleSet = testRuleSet();
    expect(setupRulesOf(ruleSet)).toEqual({
      sequence: "snake",
      rounds: [{ piece: "settlement", road: true }, { piece: "settlement", road: true }],
      startingResourcesRound: 2,
    });
    const { state, placers } = trace(ruleSet, ["A", "B", "C"]);
    expect(placers).toEqual([0, 1, 2, 2, 1, 0]);
    expect(state.turn).toEqual({ current: 0, phase: "rollDice" });
    expect(state.setupRound).toBe(2);
    expect(playSetup(newGame(ruleSet, ["A", "B", "C"]), ruleSet)).toEqual(state);
  });

  it("Cities & Knights: the second piece is a city", () => {
    const ck = testRuleSet({ citiesAndKnights: true });
    expect(setupRulesOf(ck).rounds.map((r) => r.piece)).toEqual(["settlement", "city"]);
    const { state } = trace(ck, ["A", "B"]);
    expect(Object.values(state.board.buildings).filter((b) => b?.kind === "city")).toHaveLength(2);
  });
});
