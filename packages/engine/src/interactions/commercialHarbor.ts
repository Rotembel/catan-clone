import type { CommercialHarborPayload, CommercialHarborResponse, GameState } from "@catan/shared";
import { COMMODITIES, playerMinus, playerPlus, totalCommodities } from "../resources.js";
import { illegal, requirePlayer, updatePlayer } from "../reducers/helpers.js";
import type { InteractionModule } from "./queue.js";

/** Each responder gives back one commodity of their choice for the resource offered. */
export const commercialHarbor: InteractionModule = {
  options(state, _ruleSet, responderId) {
    const me = state.players.find((p) => p.id === responderId)!;
    const held = COMMODITIES.filter((c) => me.commodities[c] > 0);
    return held.length > 0 ? held.map((commodity) => ({ commodity })) : [{}];
  },
  respond(state, _ruleSet, responderId, interaction, payload) {
    const { offers } = interaction.payload as CommercialHarborPayload;
    const resource = offers[responderId];
    if (!resource) illegal("no offer was made to you");
    const { commodity } = (payload ?? {}) as CommercialHarborResponse;
    const me = requirePlayer(state, responderId);
    const source = requirePlayer(state, interaction.sourcePlayerId);
    if (totalCommodities(me.commodities) === 0) {
      if (commodity) illegal("you hold no commodity to give");
      return state; // nothing to exchange
    }
    if (!commodity || me.commodities[commodity] <= 0) illegal("choose a commodity you hold");
    if (source.resources[resource] <= 0) return state; // the offer can no longer be honoured
    let next: GameState = updatePlayer(state, responderId, (p) => playerPlus(playerMinus(p, { [commodity]: 1 }), { [resource]: 1 }));
    next = updatePlayer(next, interaction.sourcePlayerId, (p) => playerPlus(playerMinus(p, { [resource]: 1 }), { [commodity]: 1 }));
    return next;
  },
};
