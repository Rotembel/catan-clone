// Every rule set a game can be started with, by id. The server and the
// lobby both read from here, so adding a variant is one entry.

import type { RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createBaseRuleSet, type BaseRuleSetOptions } from "./base.js";
import { FRIENDS_NIGHT_ID, createFriendsNightRuleSet } from "./variants/friendsNight.js";
import { CITIES_AND_KNIGHTS_ID, createCitiesAndKnightsRuleSet } from "./citiesAndKnights.js";
import { HOME_LARGE_ID, createHomeLargeRuleSet } from "./presets/homeLarge.js";

export interface RuleSetOptions extends BaseRuleSetOptions {
  victoryPoints?: number;
}

export interface RuleSetInfo {
  id: string;
  label: string;
  /** One line for the lobby. */
  description: string;
  /** Seats this rule set is designed for. */
  seats: { min: number; max: number };
  create: (options?: RuleSetOptions) => { ruleSet: RuleSet; state: RngState };
}

export const RULE_SETS: readonly RuleSetInfo[] = [
  {
    id: "base",
    label: "Base game",
    description: "The standard rules.",
    seats: { min: 2, max: 4 },
    create: createBaseRuleSet,
  },
  {
    id: FRIENDS_NIGHT_ID,
    label: "Friends' night",
    description: "Base game, plus development cards can be traded between players.",
    seats: { min: 2, max: 4 },
    create: createFriendsNightRuleSet,
  },
  {
    id: HOME_LARGE_ID,
    label: "Home Large — 5 Seats",
    description: "Base rules on a generated 37-hex map, three opening placements each, 13 points to win. Built for 3 humans + 2 bots.",
    seats: { min: 3, max: 5 },
    create: createHomeLargeRuleSet,
  },
  {
    id: CITIES_AND_KNIGHTS_ID,
    label: "Cities & Knights (in progress)",
    description: "Commodities, city improvements, the event die, barbarians, knights and progress cards; second placement is a city; 13 points to win. Metropolises and walls are coming.",
    seats: { min: 2, max: 4 },
    create: createCitiesAndKnightsRuleSet,
  },
];

export const DEFAULT_RULE_SET_ID = "base";

export function ruleSetInfo(id: string): RuleSetInfo | undefined {
  return RULE_SETS.find((r) => r.id === id);
}

export function createRuleSet(
  id: string = DEFAULT_RULE_SET_ID,
  options: RuleSetOptions = {}
): { ruleSet: RuleSet; state: RngState } {
  const info = ruleSetInfo(id);
  if (!info) throw new Error(`unknown rule set: ${id}`);
  return info.create(options);
}
