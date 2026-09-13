import type { GameState, WeddingResponse } from "@catan/shared";
import { CARDS, handSize, isCommodity, playerHolds, playerMinus, playerPlus, totalAllCards } from "../resources.js";
import { illegal, requirePlayer, updatePlayer } from "../reducers/helpers.js";
import type { InteractionModule } from "./queue.js";

/** Give the source 2 cards of your choice (1 if you only hold 1). */
export const wedding: InteractionModule = {
  options(state, _ruleSet, responderId) {
    const me = state.players.find((p) => p.id === responderId)!;
    const need = Math.min(2, handSize(me));
    const held = CARDS.filter((c) => (isCommodity(c) ? me.commodities[c] : me.resources[c]) > 0);
    if (need === 0) return [{ cards: {} }];
    const out: WeddingResponse[] = [];
    if (need === 1) return held.map((c) => ({ cards: { [c]: 1 } }));
    for (let i = 0; i < held.length; i++) {
      for (let j = i; j < held.length; j++) {
        const a = held[i]!, b = held[j]!;
        if (a === b) {
          const n = isCommodity(a) ? me.commodities[a] : me.resources[a];
          if (n >= 2) out.push({ cards: { [a]: 2 } });
        } else out.push({ cards: { [a]: 1, [b]: 1 } });
      }
    }
    return out;
  },
  respond(state, _ruleSet, responderId, interaction, payload) {
    const { cards } = (payload ?? {}) as WeddingResponse;
    const me = requirePlayer(state, responderId);
    const need = Math.min(2, handSize(me));
    const give = cards ?? {};
    if (totalAllCards(give) !== need) illegal(`you must give ${need} card${need === 1 ? "" : "s"}`);
    if (!playerHolds(me, give)) illegal("you do not hold those cards");
    let next: GameState = updatePlayer(state, responderId, (p) => playerMinus(p, give));
    next = updatePlayer(next, interaction.sourcePlayerId, (p) => playerPlus(p, give));
    return next;
  },
};
