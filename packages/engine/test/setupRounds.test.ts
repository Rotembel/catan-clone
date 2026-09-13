// Opening placement as data (RuleSet.setup): N snake rounds, resource grant
// from a configurable round. The base game and Cities & Knights must come
// out exactly as before.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { setupRulesOf } from "../src/reducers/setup.js";
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
    grantStartingResourcesFromRound: 3,
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

  it("grants starting resources only from the configured round", () => {
    const ruleSet = threeRounds();
    let state = newGame(ruleSet, ["A", "B"]);
    const step = () => {
      const playerId = state.players[state.turn.current]!.id;
      state = apply(state, { playerId, action: legalActions(state, ruleSet, playerId)[0]! }, ruleSet);
    };
    // Rounds 1 and 2: 2 players × (settlement + road) × 2 rounds = 8 actions, no cards.
    for (let i = 0; i < 8; i++) step();
    expect(state.setupRound).toBe(2);
    expect(state.players.every((p) => totalCards(p.resources) === 0)).toBe(true);
    // Round 3 grants.
    step(); // player 0's third settlement
    expect(totalCards(state.players[0]!.resources)).toBeGreaterThan(0);
    expect(totalCards(state.players[1]!.resources)).toBe(0);
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
    const ruleSet: RuleSet = { ...threeRounds(), setup: { sequence: "snake", rounds: [{ piece: "settlement", road: false }, { piece: "settlement", road: true }], grantStartingResourcesFromRound: 2 } };
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
      grantStartingResourcesFromRound: 2,
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
