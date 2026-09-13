// The base game as data. House rules are variations on this object, not
// forks of engine logic (CLAUDE.md: "Rules are data").

import type { RngState } from "@catan/engine";
import { createRng } from "@catan/engine";
import type { BuildKind, DevCardDef, Resource, RuleSet } from "@catan/shared";
import { generateBaseBoardLayout } from "./board.js";

export const BASE_COSTS: Record<BuildKind, Partial<Record<Resource, number>>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

/** The standard 25-card development deck. */
export const BASE_DEV_CARDS: DevCardDef[] = [
  { id: "knight", label: "Knight", count: 14, kind: "knight" },
  { id: "victoryPoint", label: "Victory Point", count: 5, kind: "victoryPoint" },
  { id: "roadBuilding", label: "Road Building", count: 2, kind: "progress" },
  { id: "yearOfPlenty", label: "Year of Plenty", count: 2, kind: "progress" },
  { id: "monopoly", label: "Monopoly", count: 2, kind: "progress" },
];

/** How many of each resource the bank starts with (19 per resource, standard). */
export const BANK_PER_RESOURCE = 19;

/** Piece limits per player, standard base game. */
export const PIECE_LIMITS = {
  roads: 15,
  settlements: 5,
  cities: 4,
} as const;

export interface BaseRuleSetOptions {
  seed?: string | number;
  /** Board radius: 2 = the standard 19-hex board. Bigger = a bigger map. */
  radius?: number;
}

/**
 * Builds the base RuleSet. The board layout is seeded, so the same seed
 * always produces the same board — which is what keeps the engine's
 * determinism guarantee meaningful end to end.
 */
export function createBaseRuleSet(options: BaseRuleSetOptions = {}): { ruleSet: RuleSet; state: RngState } {
  const seed = options.seed ?? "base";
  const { layout, state } = generateBaseBoardLayout(createRng(seed), options.radius ?? 2);

  const ruleSet: RuleSet = {
    id: "base",
    victoryPoints: 10,
    costs: BASE_COSTS,
    devCards: BASE_DEV_CARDS,
    board: layout,
    houseRules: {
      tradeDevCards: false,
    },
  };

  return { ruleSet, state };
}
