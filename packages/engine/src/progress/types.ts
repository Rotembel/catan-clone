// The bounded card-effect contract (docs/planning: a future custom deck
// implements this same shape). Not a scripting engine: each card is a small
// pure module with two responsibilities — say what is legal, and do it.

import type { GameState, RuleSet } from "@catan/shared";

export interface ProgressCardImpl {
  id: string;
  /**
   * Every legal payload for this player right now. Empty = the card cannot
   * be played now. Cards without a choice return `[undefined]`. Bounded by
   * construction (hexes, opponents, resources…), so legalActions can list them.
   */
  options(state: GameState, ruleSet: RuleSet, playerId: number): unknown[];
  /** Validate the payload (throw via illegal()) and return the new state. Never mutates. */
  apply(state: GameState, ruleSet: RuleSet, playerId: number, payload: unknown): GameState;
}
