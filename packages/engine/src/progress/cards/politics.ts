// Politics (blue) progress cards implemented in slice 3.

import type { BishopPayload, DeserterPayload, DiplomatPayload, EdgeId, GameState, IntriguePayload, RuleSet, SpyPayload, VertexId } from "@catan/shared";
import { startInteraction } from "../../interactions/queue.js";
import { displaceKnightAt } from "../../interactions/displaceKnight.js";
import { requestDiscards } from "../../reducers/dice.js";
import { totalVictoryPoints } from "../../selectors/victory.js";
import { playerHasRoadAt } from "../../selectors/building.js";
import { hexVertices } from "../../board/geometry.js";
import { getGeometry } from "../../geometryCache.js";
import { illegal, requirePlayer, updatePlayer } from "../../reducers/helpers.js";
import { expandPlayerHand, handSize, playerMinus, playerPlus } from "../../resources.js";
import { nextInt } from "../../rng.js";
import { progressCardDef } from "../deck.js";
import type { ProgressCardImpl } from "../types.js";

/** Move the robber; steal one card from *every* opponent with a building on the new hex. */
export const bishop: ProgressCardImpl = {
  id: "bishop",
  options: (state, ruleSet) => ruleSet.board.hexes.filter((h) => h.id !== state.board.robberHex).map((h) => ({ hex: h.id })),
  apply(state, ruleSet, playerId, payload) {
    const { hex } = (payload ?? {}) as BishopPayload;
    const geometry = getGeometry(ruleSet.board);
    const cube = geometry.hexes.get(hex);
    if (!cube) illegal(`no such hex: ${hex}`);
    if (hex === state.board.robberHex) illegal("the bishop must move the robber to a different hex");

    let next: GameState = { ...state, board: { ...state.board, robberHex: hex } };
    const victims = new Set<number>();
    for (const vertex of hexVertices(cube)) {
      const b = next.board.buildings[vertex];
      if (b && b.playerId !== playerId) victims.add(b.playerId);
    }
    for (const victimId of [...victims].sort((a, b) => a - b)) {
      const victim = next.players.find((p) => p.id === victimId)!;
      if (handSize(victim) === 0) continue;
      const hand = expandPlayerHand(victim);
      const { value, state: rngState } = nextInt(next.rngState, hand.length);
      const stolen = hand[value]!;
      next = {
        ...next,
        rngState,
        players: next.players.map((p) => {
          if (p.id === victimId) return playerMinus(p, { [stolen]: 1 });
          if (p.id === playerId) return playerPlus(p, { [stolen]: 1 });
          return p;
        }),
      };
    }
    return next;
  },
};

/** Activate all your knights for free. */
export const warlord: ProgressCardImpl = {
  id: "warlord",
  options: (state, _ruleSet, playerId) =>
    Object.values(state.board.knights).some((k) => k?.playerId === playerId && !k.active) ? [undefined] : [],
  apply(state, _ruleSet, playerId) {
    const knights: GameState["board"]["knights"] = {};
    let any = false;
    for (const [v, k] of Object.entries(state.board.knights)) {
      if (!k) continue;
      if (k.playerId === playerId && !k.active) {
        knights[v] = { ...k, active: true, activatedThisTurn: true };
        any = true;
      } else knights[v] = k;
    }
    if (!any) illegal("you have no inactive knights to activate");
    return { ...state, board: { ...state.board, knights } };
  },
};

/** Take a progress card of your choice from an opponent's hand. */
export const spy: ProgressCardImpl = {
  id: "spy",
  options(state, ruleSet, playerId) {
    const ck = ruleSet.citiesAndKnights!;
    const me = state.players.find((p) => p.id === playerId)!;
    // Taking a card must not push you over the limit (slight simplification
    // of the official "then discard down" rule — documented).
    if (me.progressCards.length >= ck.progressHandLimit) return [];
    const out: SpyPayload[] = [];
    for (const p of state.players) {
      if (p.id === playerId) continue;
      for (const cardId of [...new Set(p.progressCards)]) out.push({ playerId: p.id, cardId });
    }
    return out;
  },
  apply(state, ruleSet, playerId, payload) {
    const { playerId: targetId, cardId } = (payload ?? {}) as SpyPayload;
    if (targetId === playerId) illegal("the spy cannot target yourself");
    const target = requirePlayer(state, targetId);
    if (!target.progressCards.includes(cardId)) illegal(`player ${targetId} does not hold ${cardId}`);
    if (!progressCardDef(ruleSet, cardId)) illegal(`no such progress card: ${cardId}`);
    const me = requirePlayer(state, playerId);
    if (me.progressCards.length >= ruleSet.citiesAndKnights!.progressHandLimit) illegal("your progress hand is full");
    const index = target.progressCards.indexOf(cardId);
    let next = updatePlayer(state, targetId, (p) => ({
      ...p,
      progressCards: [...p.progressCards.slice(0, index), ...p.progressCards.slice(index + 1)],
    }));
    next = updatePlayer(next, playerId, (p) => ({ ...p, progressCards: [...p.progressCards, cardId] }));
    return next;
  },
};

/** Every player with more victory points gives you 2 cards of their choice (1 if they hold 1). */
export const wedding: ProgressCardImpl = {
  id: "wedding",
  options(state, ruleSet, playerId) {
    const mine = totalVictoryPoints(state, ruleSet, playerId);
    const richer = state.players.filter((p) => p.id !== playerId && totalVictoryPoints(state, ruleSet, p.id) > mine && handSize(p) > 0);
    return richer.length > 0 ? [undefined] : [];
  },
  apply(state, ruleSet, playerId) {
    const mine = totalVictoryPoints(state, ruleSet, playerId);
    const responders = state.players.filter((p) => p.id !== playerId && totalVictoryPoints(state, ruleSet, p.id) > mine && handSize(p) > 0).map((p) => p.id);
    if (responders.length === 0) illegal("nobody has more points and cards than you");
    return startInteraction(state, { kind: "wedding", sourcePlayerId: playerId, sourceCardId: "wedding", responders, payload: undefined });
  },
};

/** Players with at least as many victory points as you discard half their hand (rounded down). */
export const saboteur: ProgressCardImpl = {
  id: "saboteur",
  options(state, ruleSet, playerId) {
    const mine = totalVictoryPoints(state, ruleSet, playerId);
    return state.players.some((p) => p.id !== playerId && totalVictoryPoints(state, ruleSet, p.id) >= mine && handSize(p) >= 2) ? [undefined] : [];
  },
  apply(state, ruleSet, playerId) {
    const mine = totalVictoryPoints(state, ruleSet, playerId);
    const requests = state.players
      .filter((p) => p.id !== playerId && totalVictoryPoints(state, ruleSet, p.id) >= mine)
      .map((p) => ({ playerId: p.id, count: Math.floor(handSize(p) / 2), reason: "saboteur", sourcePlayerId: playerId, sourceCardId: "saboteur", returnPhase: state.turn.phase }));
    if (requests.every((r) => r.count === 0)) illegal("nobody would lose a card");
    return requestDiscards(state, requests);
  },
};

/** Choose an opponent: they give up a knight of their choice; you may place one of that strength. */
export const deserter: ProgressCardImpl = {
  id: "deserter",
  options: (state, _ruleSet, playerId) =>
    state.players.filter((p) => p.id !== playerId && Object.values(state.board.knights).some((k) => k?.playerId === p.id)).map((p) => ({ playerId: p.id })),
  apply(state, _ruleSet, playerId, payload) {
    const { playerId: targetId } = (payload ?? {}) as DeserterPayload;
    if (targetId === playerId) illegal("the deserter targets an opponent");
    requirePlayer(state, targetId);
    if (!Object.values(state.board.knights).some((k) => k?.playerId === targetId)) illegal("that player has no knights");
    return startInteraction(state, { kind: "deserterChoose", sourcePlayerId: playerId, sourceCardId: "deserter", responders: [targetId], payload: undefined });
  },
};

/** A road with an end that touches none of its owner's other roads or buildings. */
function isOpenRoad(state: GameState, ruleSet: RuleSet, edge: EdgeId): boolean {
  const owner = state.board.roads[edge];
  if (owner === undefined) return false;
  const geometry = getGeometry(ruleSet.board);
  const [a, b] = geometry.edgeVertices.get(edge)!;
  const anchored = (v: VertexId) =>
    state.board.buildings[v]?.playerId === owner ||
    (geometry.vertexEdges.get(v) ?? []).some((e) => e !== edge && state.board.roads[e] === owner);
  return !anchored(a) || !anchored(b);
}

/** Remove any open road; if it was yours, you may immediately re-place it. */
export const diplomat: ProgressCardImpl = {
  id: "diplomat",
  options: (state, ruleSet) => Object.keys(state.board.roads).filter((e) => isOpenRoad(state, ruleSet, e)).sort().map((edge) => ({ edge })),
  apply(state, ruleSet, playerId, payload) {
    const { edge } = (payload ?? {}) as DiplomatPayload;
    const owner = state.board.roads[edge];
    if (owner === undefined) illegal(`no road at ${edge}`);
    if (!isOpenRoad(state, ruleSet, edge)) illegal("the diplomat only removes an open road");
    const roads = { ...state.board.roads };
    delete roads[edge];
    const next: GameState = { ...state, board: { ...state.board, roads } };
    if (owner !== playerId) return next;
    return startInteraction(next, { kind: "diplomatReplace", sourcePlayerId: playerId, sourceCardId: "diplomat", responders: [playerId], payload: undefined });
  },
};

/** Displace an opponent's knight standing on one of your roads; its owner relocates it or loses it. */
export const intrigue: ProgressCardImpl = {
  id: "intrigue",
  options(state, ruleSet, playerId) {
    const geometry = getGeometry(ruleSet.board);
    return Object.entries(state.board.knights)
      .filter(([v, k]) => k && k.playerId !== playerId && playerHasRoadAt(state, geometry, v, playerId))
      .map(([vertex]) => ({ vertex }));
  },
  apply(state, ruleSet, playerId, payload) {
    const { vertex } = (payload ?? {}) as IntriguePayload;
    const knight = state.board.knights[vertex];
    if (!knight || knight.playerId === playerId) illegal(`no enemy knight at ${vertex}`);
    if (!playerHasRoadAt(state, getGeometry(ruleSet.board), vertex, playerId)) illegal("the intrigue only reaches knights on your roads");
    return displaceKnightAt(state, ruleSet, vertex, playerId, "intrigue");
  },
};

export const POLITICS_CARDS: ProgressCardImpl[] = [bishop, warlord, spy, wedding, saboteur, deserter, diplomat, intrigue];
