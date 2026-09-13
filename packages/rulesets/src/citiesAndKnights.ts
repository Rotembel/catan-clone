// Cities & Knights (SPEC.md §7 Phase 5), delivered in slices. This is the
// base game plus the expansion block; each slice adds fields to that block
// and the engine branches on them. Slice 1: commodities and city
// improvements (second placement is a city; 13 points to win).

import type { CitiesAndKnightsRules, RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createBaseRuleSet, type BaseRuleSetOptions } from "./base.js";

export const CITIES_AND_KNIGHTS_ID = "cities-and-knights";

export const CITIES_AND_KNIGHTS_RULES: CitiesAndKnightsRules = {
  commodityFor: { sheep: "cloth", ore: "coin", wood: "paper" },
  trackCommodity: { trade: "cloth", politics: "coin", science: "paper" },
  improvementCosts: [1, 2, 3, 4, 5],
  commodityPortLevel: 3,
  setupSecondPlacementIsCity: true,
  commodityBankPerType: 12,
};

export function createCitiesAndKnightsRuleSet(
  options: BaseRuleSetOptions = {}
): { ruleSet: RuleSet; state: RngState } {
  const { ruleSet: base, state } = createBaseRuleSet(options);
  return {
    ruleSet: {
      ...base,
      id: CITIES_AND_KNIGHTS_ID,
      victoryPoints: 13,
      citiesAndKnights: { ...CITIES_AND_KNIGHTS_RULES },
    },
    state,
  };
}
