// Cities & Knights knights as board pieces: build, activate, promote, move.
// Everything numeric (costs, limits, the Fortress level) comes from the
// RuleSet's citiesAndKnights block; none of this is reachable in a base game.
//
// Not in this slice (documented in HANDOFF.md): displacing a weaker enemy
// knight by moving onto it, and chasing the robber away with a knight.

import type { GameState, Knight, KnightLevel, RuleSet, VertexId } from "@catan/shared";
import { getGeometry } from "../geometryCache.js";
import { addResources, canAfford, subtractResources } from "../resources.js";
import { isVertexBlockedFor, isVertexFree, playerHasRoadAt } from "../selectors/building.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, requirePlayer, updatePlayer } from "./helpers.js";
import { displaceKnightAt } from "../interactions/displaceKnight.js";

function rules(ruleSet: RuleSet) {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("knights are not part of this rule set");
  return ck;
}

/** How many knights of each level the player has on the board. */
export function knightCounts(state: GameState, playerId: number): Record<KnightLevel, number> {
  const counts: Record<KnightLevel, number> = { 1: 0, 2: 0, 3: 0 };
  for (const knight of Object.values(state.board.knights)) {
    if (knight?.playerId === playerId) counts[knight.level]++;
  }
  return counts;
}

/** Empty vertices touching one of the player's roads — where a new knight may stand. */
export function legalKnightVertices(state: GameState, ruleSet: RuleSet, playerId: number): VertexId[] {
  const geometry = getGeometry(ruleSet.board);
  const out: VertexId[] = [];
  for (const vertex of geometry.vertexHexes.keys()) {
    if (!isVertexFree(state, vertex)) continue;
    if (playerHasRoadAt(state, geometry, vertex, playerId)) out.push(vertex);
  }
  return out;
}

/**
 * Empty vertices a knight at `from` can reach along the player's own roads,
 * without passing through an opponent's building or knight.
 */
export function knightReachableVertices(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  from: VertexId
): VertexId[] {
  return knightMoveTargets(state, ruleSet, playerId, from, 0).free;
}

/**
 * Where a knight of `level` at `from` may go: free vertices, and — if level
 * is set — vertices holding a *weaker* enemy knight it may displace. Both
 * are reached along the player's own roads; an enemy piece is never passed
 * through, but a weaker enemy knight may be the destination.
 */
export function knightMoveTargets(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  from: VertexId,
  level: number
): { free: VertexId[]; displace: VertexId[] } {
  const geometry = getGeometry(ruleSet.board);
  const seen = new Set<VertexId>([from]);
  const queue: VertexId[] = [from];
  const free: VertexId[] = [];
  const displace: VertexId[] = [];
  while (queue.length > 0) {
    const vertex = queue.shift()!;
    for (const edge of geometry.vertexEdges.get(vertex) ?? []) {
      if (state.board.roads[edge] !== playerId) continue;
      const ends = geometry.edgeVertices.get(edge)!;
      const next = ends[0] === vertex ? ends[1] : ends[0];
      if (seen.has(next)) continue;
      seen.add(next);
      if (isVertexFree(state, next)) free.push(next);
      const enemy = state.board.knights[next];
      if (enemy && enemy.playerId !== playerId && enemy.level < level) displace.push(next);
      // Own pieces can be passed through; an opponent's cannot.
      if (!isVertexBlockedFor(state, next, playerId)) queue.push(next);
    }
  }
  return { free, displace };
}

function ownKnight(state: GameState, playerId: number, vertex: VertexId): Knight {
  const knight = state.board.knights[vertex];
  if (!knight || knight.playerId !== playerId) illegal(`you have no knight at ${vertex}`);
  return knight;
}

function pay(state: GameState, playerId: number, cost: Partial<Record<import("@catan/shared").Resource, number>>, what: string): GameState {
  const player = requirePlayer(state, playerId);
  if (!canAfford(player.resources, cost)) illegal(`you cannot afford to ${what}`);
  const next = updatePlayer(state, playerId, (p) => ({ ...p, resources: subtractResources(p.resources, cost) }));
  return { ...next, bank: addResources(next.bank, cost) };
}

function withKnight(state: GameState, vertex: VertexId, knight: Knight | undefined): GameState {
  const knights = { ...state.board.knights };
  if (knight) knights[vertex] = knight;
  else delete knights[vertex];
  return { ...state, board: { ...state.board, knights } };
}

export function buildKnight(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  const ck = rules(ruleSet);
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  if (!legalKnightVertices(state, ruleSet, playerId).includes(vertex)) {
    illegal(`a knight must stand on an empty intersection next to one of your roads (${vertex})`);
  }
  if (knightCounts(state, playerId)[1] >= ck.knightsPerLevel) illegal("you have no basic knights left");

  let next = pay(state, playerId, ck.knightCosts.build, "build a knight");
  next = withKnight(next, vertex, { playerId, level: 1, active: false, activatedThisTurn: false });
  return refresh(next, ruleSet, playerId);
}

export function activateKnight(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  const ck = rules(ruleSet);
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const knight = ownKnight(state, playerId, vertex);
  if (knight.active) illegal("that knight is already active");

  let next = pay(state, playerId, ck.knightCosts.activate, "activate a knight");
  next = withKnight(next, vertex, { ...knight, active: true, activatedThisTurn: true });
  return refresh(next, ruleSet, playerId);
}

export function promoteKnight(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  const ck = rules(ruleSet);
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const knight = ownKnight(state, playerId, vertex);
  if (knight.level >= 3) illegal("a mighty knight cannot be promoted further");
  const level = (knight.level + 1) as KnightLevel;
  if (level === 3) {
    const player = requirePlayer(state, playerId);
    if (player.improvements.politics < ck.fortressLevel) {
      illegal(`promoting to a mighty knight needs the Fortress (politics level ${ck.fortressLevel})`);
    }
  }
  if (knightCounts(state, playerId)[level] >= ck.knightsPerLevel) illegal(`you have no level-${level} knights left`);

  let next = pay(state, playerId, ck.knightCosts.promote, "promote a knight");
  next = withKnight(next, vertex, { ...knight, level });
  return refresh(next, ruleSet, playerId);
}

export function moveKnight(state: GameState, ruleSet: RuleSet, playerId: number, from: VertexId, to: VertexId): GameState {
  rules(ruleSet);
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const knight = ownKnight(state, playerId, from);
  if (!knight.active) illegal("only an active knight can move");
  if (knight.activatedThisTurn) illegal("a knight cannot move in the turn it was activated");
  const targets = knightMoveTargets(state, ruleSet, playerId, from, knight.level);
  const displacing = targets.displace.includes(to);
  if (!targets.free.includes(to) && !displacing) {
    illegal(`the knight at ${from} cannot reach ${to} along your roads`);
  }

  // Moving spends the activation. A weaker enemy knight in the way is
  // displaced: its owner relocates it (or loses it) before play resumes.
  let next = withKnight(state, from, undefined);
  if (displacing) next = displaceKnightAt(next, ruleSet, to, playerId);
  next = withKnight(next, to, { ...knight, active: false });
  return refresh(next, ruleSet, playerId);
}

/** endTurn hook: the "activated this turn" restriction lapses. */
export function resetKnightTurnFlags(state: GameState): GameState {
  let changed = false;
  const knights: GameState["board"]["knights"] = {};
  for (const [vertex, knight] of Object.entries(state.board.knights)) {
    if (!knight) continue;
    if (knight.activatedThisTurn) {
      knights[vertex] = { ...knight, activatedThisTurn: false };
      changed = true;
    } else knights[vertex] = knight;
  }
  return changed ? { ...state, board: { ...state.board, knights } } : state;
}
