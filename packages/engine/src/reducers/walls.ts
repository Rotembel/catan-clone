// City walls: one per city, a few per player, paid in resources, each
// raising the robber's discard threshold. Removed when the city is lost.

import type { GameState, RuleSet, VertexId } from "@catan/shared";
import { addResources, canAfford, subtractResources } from "../resources.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, requirePlayer, updatePlayer } from "./helpers.js";

export function wallCount(state: GameState, playerId: number): number {
  return Object.values(state.board.walls).filter((o) => o === playerId).length;
}

/** The player's cities that have no wall yet. */
export function legalWallVertices(state: GameState, playerId: number): VertexId[] {
  return Object.entries(state.board.buildings)
    .filter(([v, b]) => b?.playerId === playerId && b.kind === "city" && state.board.walls[v] === undefined)
    .map(([v]) => v);
}

export function canBuildWall(state: GameState, ruleSet: RuleSet, playerId: number): boolean {
  const ck = ruleSet.citiesAndKnights;
  const player = state.players.find((p) => p.id === playerId);
  if (!ck || !player) return false;
  return wallCount(state, playerId) < ck.wall.perPlayer && canAfford(player.resources, ck.wall.cost) && legalWallVertices(state, playerId).length > 0;
}

/** Put a wall on a city without charging — the Engineer card and buildWall share it. */
export function placeWall(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("city walls are not part of this rule set");
  if (wallCount(state, playerId) >= ck.wall.perPlayer) illegal("you have no walls left");
  if (!legalWallVertices(state, playerId).includes(vertex)) illegal(`no city of yours without a wall at ${vertex}`);
  return { ...state, board: { ...state.board, walls: { ...state.board.walls, [vertex]: playerId } } };
}

export function buildWall(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("city walls are not part of this rule set");
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const player = requirePlayer(state, playerId);
  if (!canAfford(player.resources, ck.wall.cost)) illegal("you cannot afford a city wall");
  let next = placeWall(state, ruleSet, playerId, vertex);
  next = updatePlayer(next, playerId, (p) => ({ ...p, resources: subtractResources(p.resources, ck.wall.cost) }));
  next = { ...next, bank: addResources(next.bank, ck.wall.cost) };
  return refresh(next, ruleSet, playerId);
}

/** Remove the wall on a vertex, if any (the city was downgraded). */
export function removeWall(state: GameState, vertex: VertexId): GameState {
  if (state.board.walls[vertex] === undefined) return state;
  const walls = { ...state.board.walls };
  delete walls[vertex];
  return { ...state, board: { ...state.board, walls } };
}
