import { describe, expect, it } from "vitest";
import { apply, createInitialState, getGeometry, legalActions, totalCards } from "@catan/engine";
import { HOME_LARGE, HOME_LARGE_ID, MAPGEN_VERSION, createHomeLargeRuleSet, createRuleSet, ruleSetInfo } from "../src/index.js";

describe("Home Large — 5 Seats", () => {
  it("is base rules on a generated 37-hex board with three opening placements and 13 points", () => {
    const { ruleSet } = createHomeLargeRuleSet({ seed: "friends" });
    expect(ruleSet.id).toBe(HOME_LARGE_ID);
    expect(ruleSet.board.hexes).toHaveLength(37);
    expect(ruleSet.setup?.rounds).toHaveLength(3);
    expect(ruleSet.setup?.rounds.every((r) => r.piece === "settlement" && r.road)).toBe(true);
    expect(ruleSet.setup?.startingResourcesRound).toBe(2);
    expect(ruleSet.victoryPoints).toBe(13);
    expect(ruleSet.maxPlayers).toBe(5);
    expect(ruleSet.pieceLimits).toEqual(HOME_LARGE.pieceLimits);
    expect(ruleSet.citiesAndKnights).toBeUndefined();
    expect(ruleSet.houseRules.tradeDevCards).toBe(false);
    expect(ruleSet.mapgen).toMatchObject({ seed: "friends", generationVersion: MAPGEN_VERSION });
  });

  it("victory target is configurable; seed reproduces the exact board", () => {
    expect(createHomeLargeRuleSet({ seed: "x", victoryPoints: 15 }).ruleSet.victoryPoints).toBe(15);
    const a = createRuleSet(HOME_LARGE_ID, { seed: "same" });
    const b = createRuleSet(HOME_LARGE_ID, { seed: "same" });
    expect(a.ruleSet).toEqual(b.ruleSet);
    expect(a.state).toBe(b.state);
    expect(createRuleSet(HOME_LARGE_ID, { seed: "diff" }).ruleSet.board).not.toEqual(a.ruleSet.board);
  });

  it("is in the registry for 3-5 seats", () => {
    const info = ruleSetInfo(HOME_LARGE_ID)!;
    expect(info.label).toBe("Home Large — 5 Seats");
    expect(info.seats).toEqual({ min: 3, max: 5 });
  });

  it("on the real preset, 5 players are paid exactly once — from the second settlement — and the bank balances", () => {
    const { ruleSet, state: rng } = createHomeLargeRuleSet({ seed: "grant-check" });
    const geometry = getGeometry(ruleSet.board);
    let state = createInitialState(ruleSet, { playerNames: ["A", "B", "C", "D", "E"], rngState: rng });
    const secondSpot: Record<number, string> = {};
    const handsAfterRound2: Record<number, number> = {};
    let guard = 0;
    while (state.turn.phase.startsWith("setup") && guard++ < 200) {
      const playerId = state.players[state.turn.current]!.id;
      const action = legalActions(state, ruleSet, playerId)[0]!;
      const round = state.setupRound;
      state = apply(state, { playerId, action }, ruleSet);
      if (action.type === "buildSettlement" && round === 1) {
        secondSpot[playerId] = action.vertex;
        handsAfterRound2[playerId] = totalCards(state.players[playerId]!.resources);
      }
      if (round === 0 && action.type === "buildSettlement") {
        expect(totalCards(state.players[playerId]!.resources)).toBe(0); // round 1 pays nothing
      }
    }
    expect(state.turn.phase).toBe("rollDice");
    for (const p of state.players) {
      const producing = (geometry.vertexHexes.get(secondSpot[p.id]!) ?? []).filter(
        (h) => ruleSet.board.hexes.find((x) => x.id === h)!.resource !== "desert"
      ).length;
      expect(handsAfterRound2[p.id]).toBe(producing); // paid exactly its producing neighbours
      expect(totalCards(p.resources)).toBe(producing); // and nothing more in round 3
    }
    const inHands = state.players.reduce((n, p) => n + totalCards(p.resources), 0);
    expect(totalCards(state.bank) + inHands).toBe(19 * 5);
  });
});
