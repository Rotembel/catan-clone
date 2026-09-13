// Trade (yellow) progress cards implemented in slice 3.

import type { Card, GameState, MerchantFleetPayload, ResourceMonopolyPayload, RuleSet, TradeMonopolyPayload } from "@catan/shared";
import { CARDS, COMMODITIES, RESOURCES, addCommodities, addResources, isCommodity, subtractCommodities, subtractResources } from "../../resources.js";
import { illegal, updatePlayer } from "../../reducers/helpers.js";
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

export const TRADE_CARDS: ProgressCardImpl[] = [resourceMonopoly, tradeMonopoly, merchantFleet];
