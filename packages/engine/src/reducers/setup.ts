// The opening placement phase: settlement, road, settlement, road, in
// snake order (1..N then N..1). The second placement pays out its
// surrounding hexes, per the official rule. With Cities & Knights on, that
// second placement is a city (and still pays one resource per hex — no
// commodities at setup).

import type { EdgeId, GameState, Resource, RuleSet, VertexId } from "@catan/shared";
import { getGeometry } from "../geometryCache.js";
import { addResources, subtractResources } from "../resources.js";
import {
  isVertexFree,
  legalSetupRoadEdges,
  satisfiesDistanceRule,
} from "../selectors/building.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, updatePlayer } from "./helpers.js";

export function placeSetupSettlement(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  vertex: VertexId
): GameState {
  requirePhase(state, "setupSettlement1", "setupSettlement2");
  requireCurrentPlayer(state, playerId);

  const geometry = getGeometry(ruleSet.board);
  if (!geometry.vertexHexes.has(vertex)) illegal(`no such vertex on this board: ${vertex}`);
  if (!isVertexFree(state, vertex)) illegal(`vertex ${vertex} is already occupied`);
  if (!satisfiesDistanceRule(state, geometry, vertex)) {
    illegal(`vertex ${vertex} violates the distance rule`);
  }

  const isSecond = state.turn.phase === "setupSettlement2";
  const kind =
    isSecond && ruleSet.citiesAndKnights?.setupSecondPlacementIsCity ? "city" : "settlement";

  let next: GameState = {
    ...state,
    board: {
      ...state.board,
      buildings: { ...state.board.buildings, [vertex]: { playerId, kind } },
    },
    setupLastSettlement: vertex,
    turn: { ...state.turn, phase: isSecond ? "setupRoad2" : "setupRoad1" },
  };

  if (isSecond) {
    // The second settlement collects one resource from each adjacent hex.
    const gain: Partial<Record<Resource, number>> = {};
    for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
      const hex = ruleSet.board.hexes.find((h) => h.id === hexId);
      if (!hex || hex.resource === "desert") continue;
      if (next.bank[hex.resource] <= 0) continue;
      gain[hex.resource] = (gain[hex.resource] ?? 0) + 1;
    }
    next = { ...next, bank: subtractResources(next.bank, gain) };
    next = updatePlayer(next, playerId, (p) => ({ ...p, resources: addResources(p.resources, gain) }));
  }

  return refresh(next, ruleSet);
}

export function placeSetupRoad(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  edge: EdgeId
): GameState {
  requirePhase(state, "setupRoad1", "setupRoad2");
  requireCurrentPlayer(state, playerId);

  const settlement = state.setupLastSettlement;
  if (settlement === undefined) illegal("no settlement was placed for this road to connect to");
  if (!legalSetupRoadEdges(state, ruleSet, settlement).includes(edge)) {
    illegal(`road ${edge} must connect to the settlement just placed`);
  }

  const playerCount = state.players.length;
  const isFirstRound = state.turn.phase === "setupRoad1";

  let nextCurrent = state.turn.current;
  let nextPhase: GameState["turn"]["phase"];
  if (isFirstRound) {
    if (state.turn.current < playerCount - 1) {
      nextCurrent = state.turn.current + 1;
      nextPhase = "setupSettlement1";
    } else {
      // Last player places both of their settlements back to back.
      nextPhase = "setupSettlement2";
    }
  } else if (state.turn.current > 0) {
    nextCurrent = state.turn.current - 1;
    nextPhase = "setupSettlement2";
  } else {
    // Setup complete — back to the first player for the first real turn.
    nextCurrent = 0;
    nextPhase = "rollDice";
  }

  const next: GameState = {
    ...state,
    board: { ...state.board, roads: { ...state.board.roads, [edge]: playerId } },
    setupLastSettlement: undefined,
    turn: { current: nextCurrent, phase: nextPhase },
  };

  return refresh(next, ruleSet);
}
