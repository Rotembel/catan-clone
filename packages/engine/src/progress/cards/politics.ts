// Politics (blue) progress cards implemented in slice 3.

import type { BishopPayload, GameState, RuleSet, SpyPayload } from "@catan/shared";
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

export const POLITICS_CARDS: ProgressCardImpl[] = [bishop, warlord, spy];
