// Longest Road and Largest Army — the two bonus-VP awards.
//
// Both are history-dependent: the official rule is that you only take an
// award by *strictly beating* its current holder, so a tie leaves it where
// it is. That's why the holders live in GameState rather than being derived
// fresh from the board each time.

import type { EdgeId, GameState, RuleSet, VertexId } from "@catan/shared";
import { getGeometry } from "../geometryCache.js";
import { isVertexBlockedFor } from "./building.js";

export const LONGEST_ROAD_MINIMUM = 5;
export const LARGEST_ARMY_MINIMUM = 3;

/**
 * Length (in road segments) of the player's longest continuous road.
 *
 * Longest path in a general graph is NP-hard, but a player's network tops
 * out at 15 roads with vertex degree <= 3, so exhaustive DFS over simple
 * paths is fine and exact.
 */
export function longestRoadLength(state: GameState, ruleSet: RuleSet, playerId: number): number {
  const geometry = getGeometry(ruleSet.board);
  const ownEdges: EdgeId[] = [];
  for (const [edge, owner] of Object.entries(state.board.roads)) {
    if (owner === playerId) ownEdges.push(edge);
  }
  if (ownEdges.length === 0) return 0;
  const ownEdgeSet = new Set(ownEdges);

  let best = 0;
  const used = new Set<EdgeId>();

  const walk = (vertex: VertexId, length: number): void => {
    if (length > best) best = length;
    // An opponent's building breaks the road: a path may *end* there but
    // can't continue through it. Starting a path from that vertex is fine
    // (it's just the same path walked backwards), hence the length check.
    if (length > 0 && isVertexBlockedFor(state, vertex, playerId)) return;

    for (const edge of geometry.vertexEdges.get(vertex) ?? []) {
      if (!ownEdgeSet.has(edge) || used.has(edge)) continue;
      const ends = geometry.edgeVertices.get(edge);
      if (!ends) continue;
      const next = ends[0] === vertex ? ends[1] : ends[0];
      used.add(edge);
      walk(next, length + 1);
      used.delete(edge);
    }
  };

  for (const edge of ownEdges) {
    const ends = geometry.edgeVertices.get(edge);
    if (!ends) continue;
    walk(ends[0], 0);
    walk(ends[1], 0);
  }
  return best;
}

function resolveAward(
  scores: { playerId: number; score: number }[],
  minimum: number,
  currentHolder: number | undefined
): number | undefined {
  const qualifying = scores.filter((s) => s.score >= minimum);
  if (qualifying.length === 0) return undefined;
  const max = Math.max(...qualifying.map((s) => s.score));
  const leaders = qualifying.filter((s) => s.score === max).map((s) => s.playerId);

  // The holder keeps the award on a tie — you must strictly beat them.
  if (currentHolder !== undefined && leaders.includes(currentHolder)) return currentHolder;
  if (leaders.length === 1) return leaders[0];
  // Tied challengers, none of them the holder: nobody holds it.
  return undefined;
}

export function resolveLongestRoad(state: GameState, ruleSet: RuleSet): number | undefined {
  const scores = state.players.map((p) => ({
    playerId: p.id,
    score: longestRoadLength(state, ruleSet, p.id),
  }));
  return resolveAward(scores, LONGEST_ROAD_MINIMUM, state.longestRoadPlayerId);
}

export function resolveLargestArmy(state: GameState): number | undefined {
  const scores = state.players.map((p) => ({ playerId: p.id, score: p.playedKnights }));
  return resolveAward(scores, LARGEST_ARMY_MINIMUM, state.largestArmyPlayerId);
}
