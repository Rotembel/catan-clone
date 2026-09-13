import type { GameState, Player, RuleSet } from "@catan/shared";

/** Settlements/cities plus the two awards — what everyone at the table can see. */
export function publicVictoryPoints(state: GameState, playerId: number): number {
  let vp = 0;
  for (const building of Object.values(state.board.buildings)) {
    if (building?.playerId === playerId) vp += building.kind === "city" ? 2 : 1;
  }
  if (state.longestRoadPlayerId === playerId) vp += 2;
  if (state.largestArmyPlayerId === playerId) vp += 2;
  const player = state.players.find((p) => p.id === playerId);
  vp += player?.defenderOfCatan ?? 0;
  vp += player?.progressVictoryPoints ?? 0;
  return vp;
}

/** Slice-4 sources need the rule set (their values are data). */
export function expansionVictoryPoints(state: GameState, ruleSet: RuleSet, playerId: number): number {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return 0;
  let vp = 0;
  for (const m of Object.values(state.metropolises)) if (m?.playerId === playerId) vp += ck.metropolis.victoryPoints;
  if (state.merchant?.playerId === playerId) vp += ck.merchantVictoryPoints;
  return vp;
}

/** Unrevealed victory-point dev cards in hand. */
export function hiddenVictoryPoints(player: Player, ruleSet: RuleSet): number {
  const vpCardIds = new Set(
    ruleSet.devCards.filter((d) => d.kind === "victoryPoint").map((d) => d.id)
  );
  return player.devCards.filter((id) => vpCardIds.has(id)).length;
}

/**
 * What actually decides the game: public points plus hidden VP cards. A
 * player wins the moment this reaches the RuleSet's target — they don't
 * have to reveal the cards first.
 */
export function totalVictoryPoints(state: GameState, ruleSet: RuleSet, playerId: number): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  return publicVictoryPoints(state, playerId) + expansionVictoryPoints(state, ruleSet, playerId) + hiddenVictoryPoints(player, ruleSet);
}

export function hasWon(state: GameState, ruleSet: RuleSet, playerId: number): boolean {
  return totalVictoryPoints(state, ruleSet, playerId) >= ruleSet.victoryPoints;
}
