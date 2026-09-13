// The opening placement phase, driven by RuleSet.setup: N rounds of
// (piece, optional road) in snake order (1..N, N..1, 1..N, ...). Exactly
// one round — `startingResourcesRound` — pays: that piece collects one
// resource per adjacent producing hex. The classic game is two settlement
// rounds paying on the second; Cities & Knights makes the second piece a
// city; Home Large has three rounds and still pays on the second.
//
// Phase names stay the legacy four so nothing downstream changes for the
// base game: round 0 is "setupSettlement1"/"setupRoad1", every later round
// "setupSettlement2"/"setupRoad2"; `state.setupRound` says which.

import type { EdgeId, GameState, Resource, RuleSet, SetupRules, TurnPhase, VertexId } from "@catan/shared";
import { getGeometry } from "../geometryCache.js";
import { addResources, subtractResources } from "../resources.js";
import { isVertexFree, legalSetupRoadEdges, satisfiesDistanceRule } from "../selectors/building.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, updatePlayer } from "./helpers.js";

/** The setup rules in force: explicit, or derived from the classic defaults and the C&K flag. */
export function setupRulesOf(ruleSet: RuleSet): SetupRules {
  if (ruleSet.setup) return ruleSet.setup;
  const second = ruleSet.citiesAndKnights?.setupSecondPlacementIsCity ? "city" : "settlement";
  return {
    sequence: "snake",
    rounds: [
      { piece: "settlement", road: true },
      { piece: second, road: true },
    ],
    startingResourcesRound: 2,
  };
}

function placementPhase(round: number): TurnPhase {
  return round === 0 ? "setupSettlement1" : "setupSettlement2";
}
function roadPhase(round: number): TurnPhase {
  return round === 0 ? "setupRoad1" : "setupRoad2";
}

/** Snake order: even rounds run 0..N-1, odd rounds N-1..0. */
function advanceSetup(state: GameState, rules: SetupRules): GameState {
  const n = state.players.length;
  const round = state.setupRound;
  const forward = round % 2 === 0;
  let current = state.turn.current;
  let nextRound = round;

  if (forward) {
    if (current < n - 1) current++;
    else nextRound++;
  } else if (current > 0) current--;
  else nextRound++;

  if (nextRound >= rules.rounds.length) {
    return { ...state, setupRound: nextRound, turn: { current: 0, phase: "rollDice" } };
  }
  return { ...state, setupRound: nextRound, turn: { current, phase: placementPhase(nextRound) } };
}

export function placeSetupSettlement(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  vertex: VertexId
): GameState {
  requirePhase(state, "setupSettlement1", "setupSettlement2");
  requireCurrentPlayer(state, playerId);
  const rules = setupRulesOf(ruleSet);
  const round = state.setupRound;
  const roundRules = rules.rounds[round];
  if (!roundRules) illegal(`no setup round ${round}`);

  const geometry = getGeometry(ruleSet.board);
  if (!geometry.vertexHexes.has(vertex)) illegal(`no such vertex on this board: ${vertex}`);
  if (!isVertexFree(state, vertex)) illegal(`vertex ${vertex} is already occupied`);
  if (!satisfiesDistanceRule(state, geometry, vertex)) {
    illegal(`vertex ${vertex} violates the distance rule`);
  }

  let next: GameState = {
    ...state,
    board: {
      ...state.board,
      buildings: { ...state.board.buildings, [vertex]: { playerId, kind: roundRules.piece } },
    },
    setupLastSettlement: vertex,
  };

  if (round + 1 === rules.startingResourcesRound) {
    // Collect one resource from each adjacent producing hex (never a commodity).
    const gain: Partial<Record<Resource, number>> = {};
    for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
      const hex = ruleSet.board.hexes.find((h) => h.id === hexId);
      if (!hex || hex.resource === "desert") continue;
      if (next.bank[hex.resource] <= (gain[hex.resource] ?? 0)) continue;
      gain[hex.resource] = (gain[hex.resource] ?? 0) + 1;
    }
    next = { ...next, bank: subtractResources(next.bank, gain) };
    next = updatePlayer(next, playerId, (p) => ({ ...p, resources: addResources(p.resources, gain) }));
  }

  next = roundRules.road
    ? { ...next, turn: { ...next.turn, phase: roadPhase(round) } }
    : advanceSetup({ ...next, setupLastSettlement: undefined }, rules);
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

  const next: GameState = {
    ...state,
    board: { ...state.board, roads: { ...state.board.roads, [edge]: playerId } },
    setupLastSettlement: undefined,
  };
  return refresh(advanceSetup(next, setupRulesOf(ruleSet)), ruleSet);
}
