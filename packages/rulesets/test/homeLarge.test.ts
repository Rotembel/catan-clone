import { describe, expect, it } from "vitest";
import { HOME_LARGE, HOME_LARGE_ID, MAPGEN_VERSION, createHomeLargeRuleSet, createRuleSet, ruleSetInfo } from "../src/index.js";

describe("Home Large — 5 Seats", () => {
  it("is base rules on a generated 37-hex board with three opening placements and 13 points", () => {
    const { ruleSet } = createHomeLargeRuleSet({ seed: "friends" });
    expect(ruleSet.id).toBe(HOME_LARGE_ID);
    expect(ruleSet.board.hexes).toHaveLength(37);
    expect(ruleSet.setup?.rounds).toHaveLength(3);
    expect(ruleSet.setup?.rounds.every((r) => r.piece === "settlement" && r.road)).toBe(true);
    expect(ruleSet.setup?.grantStartingResourcesFromRound).toBe(3);
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
});
