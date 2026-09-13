// Science (green) progress cards implemented in slice 3.

import type { AlchemistPayload, CranePayload, EngineerPayload, GameState, InventorPayload, MedicinePayload, Resource, RoadBuildingPayload, RuleSet, SmithPayload, VertexId } from "@catan/shared";
import { getGeometry } from "../../geometryCache.js";
import { placeFreeRoad, upgradeToCity } from "../../reducers/build.js";
import { illegal, pieceCounts, pieceLimitsOf, requirePlayer, updatePlayer } from "../../reducers/helpers.js";
import { nextImprovementCost, raiseImprovement } from "../../reducers/improve.js";
import { knightCounts } from "../../reducers/knights.js";
import { legalWallVertices, placeWall, wallCount } from "../../reducers/walls.js";
import { IMPROVEMENT_TRACKS, addCommodities, addResources, canAfford, subtractCommodities, subtractResources } from "../../resources.js";
import { legalCityVertices, legalRoadEdges } from "../../selectors/building.js";
import { effectiveNumberToken } from "../../selectors/production.js";
import type { ProgressCardImpl } from "../types.js";

/** Distinct hexes of `resource` adjacent to any of the player's buildings. */
function ownAdjacentHexes(state: GameState, ruleSet: RuleSet, playerId: number, resource: Resource): number {
  const geometry = getGeometry(ruleSet.board);
  const hexes = new Set<string>();
  for (const [vertex, b] of Object.entries(state.board.buildings)) {
    if (b?.playerId !== playerId) continue;
    for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
      if (ruleSet.board.hexes.find((h) => h.id === hexId)?.resource === resource) hexes.add(hexId);
    }
  }
  return hexes.size;
}

function harvest(id: string, resource: Resource): ProgressCardImpl {
  return {
    id,
    options: (state, ruleSet, playerId) => (ownAdjacentHexes(state, ruleSet, playerId, resource) > 0 ? [undefined] : []),
    apply(state, ruleSet, playerId) {
      const hexes = ownAdjacentHexes(state, ruleSet, playerId, resource);
      if (hexes === 0) illegal(`you have no ${resource} hexes next to your buildings`);
      const amount = Math.min(2 * hexes, state.bank[resource]);
      const next = updatePlayer(state, playerId, (p) => ({ ...p, resources: addResources(p.resources, { [resource]: amount }) }));
      return { ...next, bank: subtractResources(next.bank, { [resource]: amount }) };
    },
  };
}

/** 2 wheat per adjacent field. */
export const irrigation = harvest("irrigation", "wheat");
/** 2 ore per adjacent mountain. */
export const mining = harvest("mining", "ore");

/** Two free roads. */
export const roadBuilding: ProgressCardImpl = {
  id: "roadBuilding",
  options(state, ruleSet, playerId) {
    const edges = legalRoadEdges(state, ruleSet, playerId);
    const room = pieceLimitsOf(ruleSet).roads - pieceCounts(state, playerId).roads;
    if (edges.length >= 2 && room >= 2) return [{ edges: [edges[0]!, edges[1]!] }];
    if (edges.length >= 1 && room >= 1) return [{ edges: [edges[0]!] }];
    return [];
  },
  apply(state, ruleSet, playerId, payload) {
    const { edges } = (payload ?? {}) as RoadBuildingPayload;
    if (!Array.isArray(edges) || edges.length === 0 || edges.length > 2) illegal("road building needs 1 or 2 edges");
    let next = state;
    for (const edge of edges) next = placeFreeRoad(next, ruleSet, playerId, edge);
    return next;
  },
};

const FIXED_TOKENS = new Set([2, 6, 8, 12]);

/** Swap the number tokens of two hexes (not 2, 6, 8 or 12; not the desert). */
export const inventor: ProgressCardImpl = {
  id: "inventor",
  options(state, ruleSet) {
    const eligible = ruleSet.board.hexes.filter((h) => {
      const t = effectiveNumberToken(state, h);
      return t !== null && !FIXED_TOKENS.has(t);
    });
    const out: InventorPayload[] = [];
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        if (effectiveNumberToken(state, eligible[i]!) !== effectiveNumberToken(state, eligible[j]!)) {
          out.push({ hexA: eligible[i]!.id, hexB: eligible[j]!.id });
        }
      }
    }
    return out;
  },
  apply(state, ruleSet, _playerId, payload) {
    const { hexA, hexB } = (payload ?? {}) as InventorPayload;
    const a = ruleSet.board.hexes.find((h) => h.id === hexA);
    const b = ruleSet.board.hexes.find((h) => h.id === hexB);
    if (!a || !b || hexA === hexB) illegal("the inventor needs two different hexes");
    const ta = effectiveNumberToken(state, a);
    const tb = effectiveNumberToken(state, b);
    if (ta === null || tb === null) illegal("the desert has no token to swap");
    if (FIXED_TOKENS.has(ta) || FIXED_TOKENS.has(tb)) illegal("2, 6, 8 and 12 cannot be moved");
    if (ta === tb) illegal("swapping equal tokens does nothing");
    return {
      ...state,
      board: { ...state.board, tokenOverrides: { ...state.board.tokenOverrides, [hexA]: tb, [hexB]: ta } },
    };
  },
};

/** Choose the production dice for your coming roll (the event die still rolls). */
export const alchemist: ProgressCardImpl = {
  id: "alchemist",
  options() {
    const out: AlchemistPayload[] = [];
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push({ dice: [a, b] });
    return out;
  },
  apply(state, _ruleSet, _playerId, payload) {
    const { dice } = (payload ?? {}) as AlchemistPayload;
    if (!Array.isArray(dice) || dice.length !== 2 || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) {
      illegal("the alchemist needs two die values from 1 to 6");
    }
    if (state.turn.phase !== "rollDice") illegal("the alchemist is played before rolling");
    return { ...state, alchemistDice: [dice[0]!, dice[1]!] };
  },
};

/** Promote up to two of your knights one level, for free (the Fortress rule still applies). */
export const smith: ProgressCardImpl = {
  id: "smith",
  options(state, ruleSet, playerId) {
    const ck = ruleSet.citiesAndKnights!;
    const player = state.players.find((p) => p.id === playerId)!;
    const counts = knightCounts(state, playerId);
    const promotable: VertexId[] = [];
    for (const [v, k] of Object.entries(state.board.knights)) {
      if (!k || k.playerId !== playerId || k.level >= 3) continue;
      const level = (k.level + 1) as 2 | 3;
      if (level === 3 && player.improvements.politics < ck.fortressLevel) continue;
      if (counts[level] >= ck.knightsPerLevel) continue;
      promotable.push(v);
    }
    const out: SmithPayload[] = promotable.map((v) => ({ vertices: [v] }));
    for (let i = 0; i < promotable.length; i++) for (let j = i + 1; j < promotable.length; j++) out.push({ vertices: [promotable[i]!, promotable[j]!] });
    return out;
  },
  apply(state, ruleSet, playerId, payload) {
    const { vertices } = (payload ?? {}) as SmithPayload;
    if (!Array.isArray(vertices) || vertices.length === 0 || vertices.length > 2) illegal("the smith promotes 1 or 2 knights");
    if (new Set(vertices).size !== vertices.length) illegal("the smith cannot promote the same knight twice");
    const ck = ruleSet.citiesAndKnights!;
    const player = requirePlayer(state, playerId);
    let next = state;
    for (const v of vertices) {
      const k = next.board.knights[v];
      if (!k || k.playerId !== playerId) illegal(`you have no knight at ${v}`);
      if (k.level >= 3) illegal("a mighty knight cannot be promoted further");
      const level = (k.level + 1) as 2 | 3;
      if (level === 3 && player.improvements.politics < ck.fortressLevel) illegal("a mighty knight needs the Fortress");
      if (knightCounts(next, playerId)[level] >= ck.knightsPerLevel) illegal(`you have no level-${level} knights left`);
      next = { ...next, board: { ...next.board, knights: { ...next.board.knights, [v]: { ...k, level } } } };
    }
    return next;
  },
};

/** Build a city wall for free. */
export const engineer: ProgressCardImpl = {
  id: "engineer",
  options: (state, ruleSet, playerId) =>
    wallCount(state, playerId) < ruleSet.citiesAndKnights!.wall.perPlayer ? legalWallVertices(state, playerId).map((vertex) => ({ vertex })) : [],
  apply(state, ruleSet, playerId, payload) {
    const { vertex } = (payload ?? {}) as EngineerPayload;
    if (!vertex) illegal("the engineer needs a city to wall");
    return placeWall(state, ruleSet, playerId, vertex);
  },
};

/** Upgrade a settlement to a city for 2 ore + 1 wheat. */
const MEDICINE_COST: Partial<Record<Resource, number>> = { ore: 2, wheat: 1 };
export const medicine: ProgressCardImpl = {
  id: "medicine",
  options(state, ruleSet, playerId) {
    const player = state.players.find((p) => p.id === playerId)!;
    if (!canAfford(player.resources, MEDICINE_COST)) return [];
    if (pieceCounts(state, playerId).cities >= pieceLimitsOf(ruleSet).cities) return [];
    return legalCityVertices(state, playerId).map((vertex) => ({ vertex }));
  },
  apply(state, ruleSet, playerId, payload) {
    const { vertex } = (payload ?? {}) as MedicinePayload;
    const player = requirePlayer(state, playerId);
    if (!canAfford(player.resources, MEDICINE_COST)) illegal("medicine still costs 2 ore and 1 wheat");
    if (pieceCounts(state, playerId).cities >= pieceLimitsOf(ruleSet).cities) illegal("you have no cities left");
    if (!legalCityVertices(state, playerId).includes(vertex)) illegal(`no settlement of yours at ${vertex}`);
    let next = updatePlayer(state, playerId, (p) => ({ ...p, resources: subtractResources(p.resources, MEDICINE_COST) }));
    next = { ...next, bank: addResources(next.bank, MEDICINE_COST) };
    return upgradeToCity(next, ruleSet, playerId, vertex);
  },
};

/** Build a city improvement for one commodity less. */
export const crane: ProgressCardImpl = {
  id: "crane",
  options(state, ruleSet, playerId) {
    const ck = ruleSet.citiesAndKnights!;
    const player = state.players.find((p) => p.id === playerId)!;
    if (pieceCounts(state, playerId).cities === 0) return [];
    return IMPROVEMENT_TRACKS.filter((track) => {
      const cost = nextImprovementCost(state, ruleSet, playerId, track);
      return cost !== undefined && player.commodities[ck.trackCommodity[track]] >= cost - 1;
    }).map((track) => ({ track }));
  },
  apply(state, ruleSet, playerId, payload) {
    const { track } = (payload ?? {}) as CranePayload;
    const ck = ruleSet.citiesAndKnights!;
    if (!IMPROVEMENT_TRACKS.includes(track)) illegal("the crane needs an improvement track");
    if (pieceCounts(state, playerId).cities === 0) illegal("you need a city to build a city improvement");
    const cost = nextImprovementCost(state, ruleSet, playerId, track);
    if (cost === undefined) illegal(`the ${track} track is already at its maximum level`);
    const commodity = ck.trackCommodity[track];
    const pay = Math.max(0, cost - 1);
    const player = requirePlayer(state, playerId);
    if (player.commodities[commodity] < pay) illegal(`with the crane, this level costs ${pay} ${commodity}`);
    let next = updatePlayer(state, playerId, (p) => ({ ...p, commodities: subtractCommodities(p.commodities, { [commodity]: pay }) }));
    next = { ...next, commodityBank: addCommodities(next.commodityBank, { [commodity]: pay }) };
    return raiseImprovement(next, ruleSet, playerId, track);
  },
};

export const SCIENCE_CARDS: ProgressCardImpl[] = [irrigation, mining, roadBuilding, inventor, alchemist, smith, engineer, medicine, crane];
