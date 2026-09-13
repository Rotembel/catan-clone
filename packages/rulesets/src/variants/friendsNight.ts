// HOUSE RULE #1: trading development cards between players (SPEC.md §0).
//
// A variant is the base game with a flag flipped — data, not a fork. The
// engine already gates dev cards in an offer on `houseRules.tradeDevCards`,
// so nothing in the reducers changes between the two rule sets.

import type { RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createBaseRuleSet, type BaseRuleSetOptions } from "../base.js";

export const FRIENDS_NIGHT_ID = "friends-night";

export function createFriendsNightRuleSet(
  options: BaseRuleSetOptions = {}
): { ruleSet: RuleSet; state: RngState } {
  const { ruleSet: base, state } = createBaseRuleSet(options);
  return {
    ruleSet: {
      ...base,
      id: FRIENDS_NIGHT_ID,
      houseRules: { ...base.houseRules, tradeDevCards: true },
    },
    state,
  };
}
