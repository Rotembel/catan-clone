// Every rule set a game can be started with, by id. The server and the
// lobby both read from here, so adding a variant is one entry.

import type { RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createBaseRuleSet, type BaseRuleSetOptions } from "./base.js";
import { FRIENDS_NIGHT_ID, createFriendsNightRuleSet } from "./variants/friendsNight.js";
import { CITIES_AND_KNIGHTS_ID, createCitiesAndKnightsRuleSet } from "./citiesAndKnights.js";

export interface RuleSetInfo {
  id: string;
  label: string;
  /** One line for the lobby. */
  description: string;
  create: (options?: BaseRuleSetOptions) => { ruleSet: RuleSet; state: RngState };
}

export const RULE_SETS: readonly RuleSetInfo[] = [
  {
    id: "base",
    label: "Base game",
    description: "The standard rules.",
    create: createBaseRuleSet,
  },
  {
    id: FRIENDS_NIGHT_ID,
    label: "Friends' night",
    description: "Base game, plus development cards can be traded between players.",
    create: createFriendsNightRuleSet,
  },
  {
    id: CITIES_AND_KNIGHTS_ID,
    label: "Cities & Knights (in progress)",
    description: "Commodities, city improvements, the event die, barbarians and knights; second placement is a city; 13 points to win. Progress cards, metropolises and walls are coming.",
    create: createCitiesAndKnightsRuleSet,
  },
];

export const DEFAULT_RULE_SET_ID = "base";

export function ruleSetInfo(id: string): RuleSetInfo | undefined {
  return RULE_SETS.find((r) => r.id === id);
}

export function createRuleSet(
  id: string = DEFAULT_RULE_SET_ID,
  options: BaseRuleSetOptions = {}
): { ruleSet: RuleSet; state: RngState } {
  const info = ruleSetInfo(id);
  if (!info) throw new Error(`unknown rule set: ${id}`);
  return info.create(options);
}
