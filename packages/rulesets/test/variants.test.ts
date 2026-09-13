import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULE_SET_ID,
  FRIENDS_NIGHT_ID,
  RULE_SETS,
  createBaseRuleSet,
  createFriendsNightRuleSet,
  createRuleSet,
  ruleSetInfo,
} from "../src/index.js";

describe("friends-night variant (house rule #1)", () => {
  it("is the base game with dev-card trading switched on — and nothing else", () => {
    const base = createBaseRuleSet({ seed: "same" }).ruleSet;
    const variant = createFriendsNightRuleSet({ seed: "same" }).ruleSet;

    expect(variant.id).toBe(FRIENDS_NIGHT_ID);
    expect(variant.houseRules.tradeDevCards).toBe(true);
    expect(base.houseRules.tradeDevCards).toBe(false);

    // Everything that isn't the flag is identical: same board for the same
    // seed, same costs, deck, and target.
    expect(variant.board).toEqual(base.board);
    expect(variant.costs).toEqual(base.costs);
    expect(variant.devCards).toEqual(base.devCards);
    expect(variant.victoryPoints).toBe(base.victoryPoints);
    expect({ ...variant, id: base.id, houseRules: base.houseRules }).toEqual(base);
  });

  it("does not mutate the base rule set it derives from", () => {
    const { ruleSet: base } = createBaseRuleSet();
    expect(base.houseRules.tradeDevCards).toBe(false);
    createFriendsNightRuleSet();
    expect(createBaseRuleSet().ruleSet.houseRules.tradeDevCards).toBe(false);
  });
});

describe("rule set registry", () => {
  it("lists base first as the default and resolves ids", () => {
    expect(RULE_SETS[0]?.id).toBe(DEFAULT_RULE_SET_ID);
    expect(RULE_SETS.map((r) => r.id)).toEqual(["base", FRIENDS_NIGHT_ID, "home-large-5", "cities-and-knights"]);
    expect(ruleSetInfo(FRIENDS_NIGHT_ID)?.label).toBeTruthy();
    expect(ruleSetInfo("nope")).toBeUndefined();
  });

  it("creates by id, with the same seed giving the same board across variants", () => {
    expect(createRuleSet().ruleSet.id).toBe("base");
    const a = createRuleSet("base", { seed: "x" }).ruleSet;
    const b = createRuleSet(FRIENDS_NIGHT_ID, { seed: "x" }).ruleSet;
    expect(b.board).toEqual(a.board);
    expect(b.houseRules.tradeDevCards).toBe(true);
    expect(() => createRuleSet("nope")).toThrow(/unknown rule set/);
  });
});
