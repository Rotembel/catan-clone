import { describe, expect, it } from "vitest";
import { createBaseRuleSet, createCitiesAndKnightsRuleSet, createRuleSet } from "../src/index.js";

describe("Cities & Knights rule set (slice 1)", () => {
  it("is the base board with the expansion block and a 13-point target", () => {
    const base = createBaseRuleSet({ seed: "ck" }).ruleSet;
    const ck = createCitiesAndKnightsRuleSet({ seed: "ck" }).ruleSet;
    expect(ck.id).toBe("cities-and-knights");
    expect(ck.board).toEqual(base.board);
    expect(ck.costs).toEqual(base.costs);
    expect(ck.victoryPoints).toBe(13);
    expect(ck.citiesAndKnights).toBeDefined();
    expect(base.citiesAndKnights).toBeUndefined();
  });

  it("maps pasture/mountain/forest to cloth/coin/paper and prices levels 1-5", () => {
    const rules = createCitiesAndKnightsRuleSet().ruleSet.citiesAndKnights!;
    expect(rules.commodityFor).toEqual({ sheep: "cloth", ore: "coin", wood: "paper" });
    expect(rules.trackCommodity).toEqual({ trade: "cloth", politics: "coin", science: "paper" });
    expect(rules.improvementCosts).toEqual([1, 2, 3, 4, 5]);
    expect(rules.commodityPortLevel).toBe(3);
    expect(rules.setupSecondPlacementIsCity).toBe(true);
    expect(rules.commodityBankPerType).toBe(12);
  });

  it("is reachable from the registry", () => {
    expect(createRuleSet("cities-and-knights").ruleSet.citiesAndKnights).toBeDefined();
  });
});
