// Bank/port trades and player-to-player trades.
//
// Dev cards in a trade are gated on ruleSet.houseRules.tradeDevCards —
// HOUSE RULE #1. The base RuleSet leaves it off, so the same code path
// serves both without a fork.

import type { GameState, Resource, RuleSet, TradeOffer } from "@catan/shared";
import { addResources, canAfford, subtractResources, totalCards } from "../resources.js";
import { tradeRatiosFor } from "../selectors/production.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, requirePlayer } from "./helpers.js";

function offerHasDevCards(offer: TradeOffer): boolean {
  return (offer.giveDevCards?.length ?? 0) > 0 || (offer.receiveDevCards?.length ?? 0) > 0;
}

function holdsDevCards(cards: string[], required: string[]): boolean {
  const pool = [...cards];
  for (const id of required) {
    const index = pool.indexOf(id);
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

function removeDevCards(cards: string[], remove: string[]): string[] {
  const pool = [...cards];
  for (const id of remove) {
    const index = pool.indexOf(id);
    if (index >= 0) pool.splice(index, 1);
  }
  return pool;
}

/**
 * A bank or port trade: give N of one resource, take back N/ratio of
 * whatever you like, where ratio is the best one this player has access to.
 */
function bankTrade(state: GameState, ruleSet: RuleSet, playerId: number, offer: TradeOffer): GameState {
  if (offerHasDevCards(offer)) illegal("the bank does not trade development cards");

  const giveEntries = (Object.entries(offer.give) as [Resource, number][]).filter(([, n]) => n > 0);
  if (giveEntries.length !== 1) illegal("a bank trade gives exactly one resource type");
  const [giveResource, giveAmount] = giveEntries[0]!;

  const ratio = tradeRatiosFor(state, ruleSet, playerId)[giveResource];
  if (giveAmount % ratio !== 0) {
    illegal(`a bank trade for ${giveResource} must be in multiples of ${ratio}`);
  }
  const receiveCount = totalCards(offer.receive);
  if (receiveCount !== giveAmount / ratio) {
    illegal(`giving ${giveAmount} ${giveResource} at ${ratio}:1 buys ${giveAmount / ratio}, not ${receiveCount}`);
  }

  const player = requirePlayer(state, playerId);
  if (!canAfford(player.resources, offer.give)) illegal("you don't hold what you're offering");
  for (const [resource, amount] of Object.entries(offer.receive) as [Resource, number][]) {
    if (state.bank[resource] < amount) illegal(`the bank has no ${resource} left`);
  }

  const next: GameState = {
    ...state,
    bank: subtractResources(addResources(state.bank, offer.give), offer.receive),
    players: state.players.map((p) =>
      p.id === playerId
        ? { ...p, resources: addResources(subtractResources(p.resources, offer.give), offer.receive) }
        : p
    ),
  };
  return refresh(next, ruleSet, playerId);
}

export function proposeTrade(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  offer: TradeOffer
): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  if (offer.fromPlayerId !== playerId) illegal("you can only propose trades as yourself");

  if (offerHasDevCards(offer) && !ruleSet.houseRules.tradeDevCards) {
    illegal("trading development cards is off in this rule set");
  }

  if (offer.toPlayerId === undefined) return bankTrade(state, ruleSet, playerId, offer);

  if (offer.toPlayerId === playerId) illegal("you cannot trade with yourself");
  requirePlayer(state, offer.toPlayerId);
  if (state.pendingTrade) illegal("there is already a trade on the table");
  if (totalCards(offer.give) === 0 && (offer.giveDevCards?.length ?? 0) === 0) {
    illegal("a trade must offer something");
  }

  return { ...state, pendingTrade: offer };
}

export function respondTrade(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  accept: boolean
): GameState {
  const offer = state.pendingTrade;
  if (!offer) illegal("there is no trade to respond to");
  if (offer.toPlayerId !== playerId) illegal(`the trade was not offered to player ${playerId}`);

  if (!accept) return { ...state, pendingTrade: undefined };

  const proposer = requirePlayer(state, offer.fromPlayerId);
  const responder = requirePlayer(state, playerId);

  if (!canAfford(proposer.resources, offer.give)) illegal("the proposer no longer holds their side");
  if (!canAfford(responder.resources, offer.receive)) illegal("you don't hold your side of the trade");

  const giveDevCards = offer.giveDevCards ?? [];
  const receiveDevCards = offer.receiveDevCards ?? [];
  if (!holdsDevCards(proposer.devCards, giveDevCards)) illegal("the proposer no longer holds those cards");
  if (!holdsDevCards(responder.devCards, receiveDevCards)) illegal("you don't hold those cards");

  const next: GameState = {
    ...state,
    pendingTrade: undefined,
    players: state.players.map((p) => {
      if (p.id === offer.fromPlayerId) {
        return {
          ...p,
          resources: addResources(subtractResources(p.resources, offer.give), offer.receive),
          devCards: [...removeDevCards(p.devCards, giveDevCards), ...receiveDevCards],
        };
      }
      if (p.id === playerId) {
        return {
          ...p,
          resources: addResources(subtractResources(p.resources, offer.receive), offer.give),
          devCards: [...removeDevCards(p.devCards, receiveDevCards), ...giveDevCards],
        };
      }
      return p;
    }),
  };

  return refresh(next, ruleSet, offer.fromPlayerId);
}
