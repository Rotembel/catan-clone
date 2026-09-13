// Trade (yellow) progress cards implemented in slice 3.

import type { Card, CardCounts, GameState, MasterMerchantPayload, MerchantFleetPayload, MerchantPayload, ResourceMonopolyPayload, RuleSet, TradeMonopolyPayload } from "@catan/shared";
import { CARDS, COMMODITIES, RESOURCES, addCommodities, addResources, isCommodity, playerHolds, playerMinus, playerPlus, subtractCommodities, subtractResources, totalAllCards } from "../../resources.js";
import { getGeometry } from "../../geometryCache.js";
import { illegal, requirePlayer, updatePlayer } from "../../reducers/helpers.js";
import { totalVictoryPoints } from "../../selectors/victory.js";
import type { ProgressCardImpl } from "../types.js";

/** Take up to 2 of one resource from every opponent. */
export const resourceMonopoly: ProgressCardImpl = {
  id: "resourceMonopoly",
  options: () => RESOURCES.map((resource) => ({ resource })),
  apply(state, _ruleSet, playerId, payload) {
    const { resource } = (payload ?? {}) as ResourceMonopolyPayload;
    if (!RESOURCES.includes(resource)) illegal("resource monopoly needs a resource");
    let taken = 0;
    let next: GameState = {
      ...state,
      players: state.players.map((p) => {
        if (p.id === playerId) return p;
        const amount = Math.min(2, p.resources[resource]);
        if (amount <= 0) return p;
        taken += amount;
        return { ...p, resources: subtractResources(p.resources, { [resource]: amount }) };
      }),
    };
    next = updatePlayer(next, playerId, (p) => ({ ...p, resources: addResources(p.resources, { [resource]: taken }) }));
    return next;
  },
};

/** Take 1 of one commodity from every opponent. */
export const tradeMonopoly: ProgressCardImpl = {
  id: "tradeMonopoly",
  options: () => COMMODITIES.map((commodity) => ({ commodity })),
  apply(state, _ruleSet, playerId, payload) {
    const { commodity } = (payload ?? {}) as TradeMonopolyPayload;
    if (!COMMODITIES.includes(commodity)) illegal("trade monopoly needs a commodity");
    let taken = 0;
    let next: GameState = {
      ...state,
      players: state.players.map((p) => {
        if (p.id === playerId || p.commodities[commodity] <= 0) return p;
        taken += 1;
        return { ...p, commodities: subtractCommodities(p.commodities, { [commodity]: 1 }) };
      }),
    };
    next = updatePlayer(next, playerId, (p) => ({ ...p, commodities: addCommodities(p.commodities, { [commodity]: taken }) }));
    return next;
  },
};

/** For the rest of this turn, one card type trades 2:1 with the bank. */
export const merchantFleet: ProgressCardImpl = {
  id: "merchantFleet",
  options: () => CARDS.map((card) => ({ card })),
  apply(state, _ruleSet, playerId, payload) {
    const { card } = (payload ?? {}) as MerchantFleetPayload;
    if (!CARDS.includes(card as Card)) illegal("merchant fleet needs a resource or commodity");
    void isCommodity;
    return updatePlayer(state, playerId, (p) => ({ ...p, merchantFleet: card }));
  },
};

/** Land hexes next to one of the player's buildings — where the merchant may stand. */
function merchantHexes(state: GameState, ruleSet: RuleSet, playerId: number): string[] {
  const geometry = getGeometry(ruleSet.board);
  const out = new Set<string>();
  for (const [vertex, b] of Object.entries(state.board.buildings)) {
    if (b?.playerId !== playerId) continue;
    for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
      const hex = ruleSet.board.hexes.find((h) => h.id === hexId);
      if (hex && hex.resource !== "desert") out.add(hexId);
    }
  }
  return [...out].sort();
}

/** Place (or move, taking it over) the merchant on a land hex next to your building. */
export const merchant: ProgressCardImpl = {
  id: "merchant",
  options: (state, ruleSet, playerId) =>
    merchantHexes(state, ruleSet, playerId).filter((h) => !(state.merchant?.playerId === playerId && state.merchant.hex === h)).map((hex) => ({ hex })),
  apply(state, ruleSet, playerId, payload) {
    const { hex } = (payload ?? {}) as MerchantPayload;
    if (!merchantHexes(state, ruleSet, playerId).includes(hex)) illegal("the merchant must stand on a land hex next to one of your buildings");
    return { ...state, merchant: { hex, playerId } };
  },
};

/** Take 2 cards of your choice from a player with more victory points than you. */
export const masterMerchant: ProgressCardImpl = {
  id: "masterMerchant",
  options(state, ruleSet, playerId) {
    const mine = totalVictoryPoints(state, ruleSet, playerId);
    const out: MasterMerchantPayload[] = [];
    for (const p of state.players) {
      if (p.id === playerId || totalVictoryPoints(state, ruleSet, p.id) <= mine) continue;
      // One option per card type they hold: two of it if they have two, else one.
      for (const c of CARDS) {
        const held = isCommodity(c) ? p.commodities[c] : p.resources[c];
        if (held > 0) out.push({ playerId: p.id, cards: { [c]: Math.min(2, held) } });
      }
    }
    return out;
  },
  apply(state, ruleSet, playerId, payload) {
    const { playerId: targetId, cards } = (payload ?? {}) as MasterMerchantPayload;
    if (targetId === playerId) illegal("the master merchant targets another player");
    const target = requirePlayer(state, targetId);
    if (totalVictoryPoints(state, ruleSet, targetId) <= totalVictoryPoints(state, ruleSet, playerId)) illegal("the master merchant only takes from a player with more points");
    const take: CardCounts = cards ?? {};
    const n = totalAllCards(take);
    if (n < 1 || n > 2) illegal("the master merchant takes 1 or 2 cards");
    if (!playerHolds(target, take)) illegal("that player does not hold those cards");
    let next = updatePlayer(state, targetId, (p) => playerMinus(p, take));
    next = updatePlayer(next, playerId, (p) => playerPlus(p, take));
    return next;
  },
};

export const TRADE_CARDS: ProgressCardImpl[] = [resourceMonopoly, tradeMonopoly, merchantFleet, merchant, masterMerchant];
