// Building roads, settlements and cities during a normal turn.
// Costs come from the RuleSet, never hardcoded here.

import type { EdgeId, GameState, RuleSet, VertexId } from "@catan/shared";
import { addResources, canAfford, subtractResources } from "../resources.js";
import { legalCityVertices, legalRoadEdges, legalSettlementVertices } from "../selectors/building.js";
import {
  illegal,
  pieceCounts,
  pieceLimitsOf,
  refresh,
  requireCurrentPlayer,
  requirePhase,
  updatePlayer,
} from "./helpers.js";

/** Pays a build cost from the player's hand back into the bank. */
function payCost(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  kind: keyof RuleSet["costs"]
): GameState {
  const cost = ruleSet.costs[kind];
  const player = state.players.find((p) => p.id === playerId)!;
  if (!canAfford(player.resources, cost)) illegal(`player ${playerId} cannot afford a ${kind}`);
  const next = updatePlayer(state, playerId, (p) => ({
    ...p,
    resources: subtractResources(p.resources, cost),
  }));
  return { ...next, bank: addResources(next.bank, cost) };
}

export function buildRoad(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  edge: EdgeId
): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  if (pieceCounts(state, playerId).roads >= pieceLimitsOf(ruleSet).roads) {
    illegal(`player ${playerId} has no roads left`);
  }
  if (!legalRoadEdges(state, ruleSet, playerId).includes(edge)) {
    illegal(`player ${playerId} cannot build a road at ${edge}`);
  }

  let next = payCost(state, ruleSet, playerId, "road");
  next = { ...next, board: { ...next.board, roads: { ...next.board.roads, [edge]: playerId } } };
  return refresh(next, ruleSet, playerId);
}

/** Places a road without charging for it — used by the Road Building card. */
export function placeFreeRoad(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  edge: EdgeId
): GameState {
  if (pieceCounts(state, playerId).roads >= pieceLimitsOf(ruleSet).roads) {
    illegal(`player ${playerId} has no roads left`);
  }
  if (!legalRoadEdges(state, ruleSet, playerId).includes(edge)) {
    illegal(`player ${playerId} cannot build a road at ${edge}`);
  }
  return { ...state, board: { ...state.board, roads: { ...state.board.roads, [edge]: playerId } } };
}

export function buildSettlement(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  vertex: VertexId
): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  if (pieceCounts(state, playerId).settlements >= pieceLimitsOf(ruleSet).settlements) {
    illegal(`player ${playerId} has no settlements left`);
  }
  const legal = legalSettlementVertices(state, ruleSet, playerId, { requireRoadConnection: true });
  if (!legal.includes(vertex)) {
    illegal(`player ${playerId} cannot build a settlement at ${vertex}`);
  }

  let next = payCost(state, ruleSet, playerId, "settlement");
  next = {
    ...next,
    board: {
      ...next.board,
      buildings: { ...next.board.buildings, [vertex]: { playerId, kind: "settlement" } },
    },
  };
  return refresh(next, ruleSet, playerId);
}

export function buildCity(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  vertex: VertexId
): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  if (pieceCounts(state, playerId).cities >= pieceLimitsOf(ruleSet).cities) {
    illegal(`player ${playerId} has no cities left`);
  }
  if (!legalCityVertices(state, playerId).includes(vertex)) {
    illegal(`player ${playerId} has no settlement to upgrade at ${vertex}`);
  }

  let next = payCost(state, ruleSet, playerId, "city");
  next = {
    ...next,
    board: {
      ...next.board,
      buildings: { ...next.board.buildings, [vertex]: { playerId, kind: "city" } },
    },
  };
  return refresh(next, ruleSet, playerId);
}
