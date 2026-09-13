// Metropolises: one per improvement track, worth extra VP, immune to the
// barbarians. Ownership lives in GameState.metropolises only; the building
// under it stays an ordinary city.
//
// Rules (claimLevel 4, takeLevel 5 in the official game):
// - reaching claimLevel claims an unowned metropolis;
// - reaching takeLevel takes one from a holder still below takeLevel;
// - a holder at takeLevel can never lose it (two players at 5: holder keeps);
// - it must stand on one of your cities: exactly one eligible city places it
//   automatically, several put you in "metropolisPlacement" to choose, none
//   leaves the claim open until you next build a city (checked there too).

import type { GameState, ImprovementTrack, RuleSet, VertexId } from "@catan/shared";
import { IMPROVEMENT_TRACKS } from "../resources.js";
import { illegal, refresh, requirePhase, requirePlayer } from "./helpers.js";

/** Cities of the player that could carry a metropolis (no metropolis on them yet). */
export function metropolisEligibleCities(state: GameState, playerId: number): VertexId[] {
  const taken = new Set(Object.values(state.metropolises).map((m) => m?.vertex));
  return Object.entries(state.board.buildings)
    .filter(([v, b]) => b?.playerId === playerId && b.kind === "city" && !taken.has(v))
    .map(([v]) => v);
}

function levelOf(state: GameState, playerId: number, track: ImprovementTrack): number {
  return state.players.find((p) => p.id === playerId)?.improvements[track] ?? 0;
}

/** Does `playerId` have a claim on this track's metropolis right now? */
export function metropolisClaim(state: GameState, ruleSet: RuleSet, playerId: number, track: ImprovementTrack): "claim" | "take" | undefined {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return undefined;
  const level = levelOf(state, playerId, track);
  const holder = state.metropolises[track];
  if (!holder) return level >= ck.metropolis.claimLevel ? "claim" : undefined;
  if (holder.playerId === playerId) return undefined;
  if (level >= ck.metropolis.takeLevel && levelOf(state, holder.playerId, track) < ck.metropolis.takeLevel) return "take";
  return undefined;
}

function award(state: GameState, playerId: number, track: ImprovementTrack, vertex: VertexId): GameState {
  return { ...state, metropolises: { ...state.metropolises, [track]: { playerId, vertex } } };
}

/**
 * After an improvement or a new city: settle any claim `playerId` has on
 * `tracks`. Returns the state, possibly paused in "metropolisPlacement".
 * Does not refresh (the caller does).
 */
export function resolveMetropolisClaims(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  tracks: readonly ImprovementTrack[] = IMPROVEMENT_TRACKS
): GameState {
  let next = state;
  if (next.pendingMetropolis) return next; // one decision at a time
  for (const track of tracks) {
    const claim = metropolisClaim(next, ruleSet, playerId, track);
    if (!claim) continue;
    const cities = metropolisEligibleCities(next, playerId);
    if (cities.length === 0) continue; // stays open until a city exists
    if (cities.length === 1) {
      next = award(next, playerId, track, cities[0]!);
      continue;
    }
    next = { ...next, pendingMetropolis: { playerId, track }, turn: { ...next.turn, phase: "metropolisPlacement" } };
    return next;
  }
  return next;
}

export function placeMetropolis(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  if (!ruleSet.citiesAndKnights) illegal("metropolises are not part of this rule set");
  requirePhase(state, "metropolisPlacement");
  requirePlayer(state, playerId);
  const pending = state.pendingMetropolis;
  if (!pending || pending.playerId !== playerId) illegal(`player ${playerId} has no metropolis to place`);
  if (!metropolisEligibleCities(state, playerId).includes(vertex)) illegal(`no eligible city of yours at ${vertex}`);

  let next = award(state, playerId, pending.track, vertex);
  next = { ...next, pendingMetropolis: undefined, turn: { ...next.turn, phase: "mainTurn" } };
  // A single improvement can only move one metropolis, but a new city may
  // have unblocked another open claim.
  next = resolveMetropolisClaims(next, ruleSet, playerId);
  return refresh(next, ruleSet, playerId);
}

/** Vertices whose city carries a metropolis (barbarian-immune). */
export function metropolisVertices(state: GameState): Set<VertexId> {
  return new Set(Object.values(state.metropolises).flatMap((m) => (m ? [m.vertex] : [])));
}
