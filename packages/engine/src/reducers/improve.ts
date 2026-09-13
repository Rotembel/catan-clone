// Cities & Knights city improvements: three tracks, paid in that track's
// commodity, level n costing improvementCosts[n-1]. You need at least one
// city to improve. Everything numeric comes from the RuleSet.

import type { GameState, ImprovementTrack, RuleSet } from "@catan/shared";
import { addCommodities, subtractCommodities } from "../resources.js";
import { illegal, pieceCounts, refresh, requireCurrentPlayer, requirePhase, requirePlayer, updatePlayer } from "./helpers.js";
import { resolveMetropolisClaims } from "./metropolis.js";

export function maxImprovementLevel(ruleSet: RuleSet): number {
  return ruleSet.citiesAndKnights?.improvementCosts.length ?? 0;
}

/** Cost, in the track's commodity, of the player's *next* level; undefined if maxed or off. */
export function nextImprovementCost(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  track: ImprovementTrack
): number | undefined {
  const ck = ruleSet.citiesAndKnights;
  const player = state.players.find((p) => p.id === playerId);
  if (!ck || !player) return undefined;
  return ck.improvementCosts[player.improvements[track]];
}

export function canBuildImprovement(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  track: ImprovementTrack
): boolean {
  const ck = ruleSet.citiesAndKnights;
  const player = state.players.find((p) => p.id === playerId);
  if (!ck || !player) return false;
  if (pieceCounts(state, playerId).cities === 0) return false;
  const cost = nextImprovementCost(state, ruleSet, playerId, track);
  if (cost === undefined) return false;
  return player.commodities[ck.trackCommodity[track]] >= cost;
}

export function buildImprovement(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  track: ImprovementTrack
): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("city improvements are not part of this rule set");
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const player = requirePlayer(state, playerId);
  if (!(track in ck.trackCommodity)) illegal(`no such improvement track: ${String(track)}`);

  if (pieceCounts(state, playerId).cities === 0) illegal("you need a city to build a city improvement");
  const cost = nextImprovementCost(state, ruleSet, playerId, track);
  if (cost === undefined) illegal(`the ${track} track is already at its maximum level`);
  const commodity = ck.trackCommodity[track];
  if (player.commodities[commodity] < cost) {
    illegal(`level ${player.improvements[track] + 1} ${track} costs ${cost} ${commodity}`);
  }

  let next = updatePlayer(state, playerId, (p) => ({
    ...p,
    commodities: subtractCommodities(p.commodities, { [commodity]: cost }),
    improvements: { ...p.improvements, [track]: p.improvements[track] + 1 },
  }));
  next = { ...next, commodityBank: addCommodities(next.commodityBank, { [commodity]: cost }) };
  next = resolveMetropolisClaims(next, ruleSet, playerId, [track]);
  return refresh(next, ruleSet, playerId);
}

/** Upgrade a track without paying — the Crane discount is applied by the caller. */
export function raiseImprovement(state: GameState, ruleSet: RuleSet, playerId: number, track: ImprovementTrack): GameState {
  const next = updatePlayer(state, playerId, (p) => ({ ...p, improvements: { ...p.improvements, [track]: p.improvements[track] + 1 } }));
  return resolveMetropolisClaims(next, ruleSet, playerId, [track]);
}
