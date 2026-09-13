// Where a player may legally build. The distance rule and road connectivity
// both live here, and both read from the derived adjacency maps.

import type { EdgeId, GameState, RuleSet, VertexId } from "@catan/shared";
import type { BoardGeometry } from "../board/adjacency.js";
import { getGeometry } from "../geometryCache.js";

/** No building stands on this vertex. */
export function isVertexFree(state: GameState, vertex: VertexId): boolean {
  return state.board.buildings[vertex] === undefined;
}

/**
 * The distance rule: no settlement/city may stand on a vertex directly
 * adjacent to another settlement/city — anyone's.
 */
export function satisfiesDistanceRule(
  state: GameState,
  geometry: BoardGeometry,
  vertex: VertexId
): boolean {
  const neighbors = geometry.vertexNeighbors.get(vertex) ?? [];
  return neighbors.every((n) => state.board.buildings[n] === undefined);
}

/** The player has a road on at least one edge touching this vertex. */
export function playerHasRoadAt(
  state: GameState,
  geometry: BoardGeometry,
  vertex: VertexId,
  playerId: number
): boolean {
  const edges = geometry.vertexEdges.get(vertex) ?? [];
  return edges.some((e) => state.board.roads[e] === playerId);
}

/**
 * A vertex is "blocked" for a player's road network if an *opponent's*
 * building sits on it — roads can't be built through, or counted through,
 * an enemy settlement.
 */
export function isVertexBlockedFor(state: GameState, vertex: VertexId, playerId: number): boolean {
  const building = state.board.buildings[vertex];
  return building !== undefined && building.playerId !== playerId;
}

export interface SettlementOptions {
  /** Main-phase settlements must connect to your road network; setup ones don't. */
  requireRoadConnection: boolean;
}

export function legalSettlementVertices(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  options: SettlementOptions
): VertexId[] {
  const geometry = getGeometry(ruleSet.board);
  const result: VertexId[] = [];
  for (const vertex of geometry.vertexHexes.keys()) {
    if (!isVertexFree(state, vertex)) continue;
    if (!satisfiesDistanceRule(state, geometry, vertex)) continue;
    if (options.requireRoadConnection && !playerHasRoadAt(state, geometry, vertex, playerId)) continue;
    result.push(vertex);
  }
  return result;
}

export function legalCityVertices(state: GameState, playerId: number): VertexId[] {
  const result: VertexId[] = [];
  for (const [vertex, building] of Object.entries(state.board.buildings)) {
    if (building && building.playerId === playerId && building.kind === "settlement") {
      result.push(vertex);
    }
  }
  return result;
}

/**
 * Edges where the player may build a road: empty, on the board, and
 * touching either one of their own buildings or one of their own roads —
 * but not reached only *through* an opponent's building.
 */
export function legalRoadEdges(state: GameState, ruleSet: RuleSet, playerId: number): EdgeId[] {
  const geometry = getGeometry(ruleSet.board);
  const result: EdgeId[] = [];
  for (const [edge, vertices] of geometry.edgeVertices) {
    if (state.board.roads[edge] !== undefined) continue;
    const connects = vertices.some((v) => {
      const building = state.board.buildings[v];
      if (building?.playerId === playerId) return true;
      // Extending from an existing road, as long as this vertex isn't
      // occupied by an opponent (you can't build past their settlement).
      if (isVertexBlockedFor(state, v, playerId)) return false;
      return playerHasRoadAt(state, geometry, v, playerId);
    });
    if (connects) result.push(edge);
  }
  return result;
}

/** Setup roads must touch the settlement placed in the same setup step. */
export function legalSetupRoadEdges(
  state: GameState,
  ruleSet: RuleSet,
  settlement: VertexId
): EdgeId[] {
  const geometry = getGeometry(ruleSet.board);
  const edges = geometry.vertexEdges.get(settlement) ?? [];
  return edges.filter((e) => state.board.roads[e] === undefined);
}
