// Bank/port trades and player-to-player trades.
//
// Dev cards in a trade are gated on ruleSet.houseRules.tradeDevCards —
// HOUSE RULE #1. Commodities in a trade are gated on ruleSet.citiesAndKnights.
// The base RuleSet has neither, so the same code path serves all without a fork.

import type { Card, GameState, RuleSet, TradeOffer } from "@catan/shared";
import {
  CARDS,
  addCommodities,
  addResources,
  isCommodity,
  playerHolds,
  playerMinus,
  playerPlus,
  splitCards,
  subtractCommodities,
  subtractResources,
  totalAllCards,
} from "../resources.js";
import { commodityTradeRatioFor, tradeRatiosFor } from "../selectors/production.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, requirePlayer } from "./helpers.js";

function offerHasDevCards(offer: TradeOffer): boolean {
  return (offer.giveDevCards?.length ?? 0) > 0 || (offer.receiveDevCards?.length ?? 0) > 0;
}

function offerHasCommodities(offer: TradeOffer): boolean {
  return CARDS.some((c) => isCommodity(c) && ((offer.give[c] ?? 0) > 0 || (offer.receive[c] ?? 0) > 0));
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

/** Cards in the bank, mixed. */
function bankHolds(state: GameState, counts: TradeOffer["receive"]): Card | undefined {
  const { resources, commodities } = splitCards(counts);
  for (const [r, n] of Object.entries(resources)) if (state.bank[r as keyof typeof state.bank] < (n ?? 0)) return r as Card;
  for (const [c, n] of Object.entries(commodities)) if (state.commodityBank[c as keyof typeof state.commodityBank] < (n ?? 0)) return c as Card;
  return undefined;
}

/**
 * A bank or port trade: give N of one card type, take back N/ratio of
 * whatever you like, where ratio is the best one this player has access to.
 */
function bankTrade(state: GameState, ruleSet: RuleSet, playerId: number, offer: TradeOffer): GameState {
  if (offerHasDevCards(offer)) illegal("the bank does not trade development cards");

  const giveEntries = (Object.entries(offer.give) as [Card, number][]).filter(([, n]) => n > 0);
  if (giveEntries.length !== 1) illegal("a bank trade gives exactly one card type");
  const [giveCard, giveAmount] = giveEntries[0]!;

  const ratio = isCommodity(giveCard)
    ? commodityTradeRatioFor(state, ruleSet, playerId, giveCard)
    : tradeRatiosFor(state, ruleSet, playerId)[giveCard];
  if (giveAmount % ratio !== 0) {
    illegal(`a bank trade for ${giveCard} must be in multiples of ${ratio}`);
  }
  const receiveCount = totalAllCards(offer.receive);
  if (receiveCount !== giveAmount / ratio) {
    illegal(`giving ${giveAmount} ${giveCard} at ${ratio}:1 buys ${giveAmount / ratio}, not ${receiveCount}`);
  }

  const player = requirePlayer(state, playerId);
  if (!playerHolds(player, offer.give)) illegal("you don't hold what you're offering");
  const short = bankHolds(state, offer.receive);
  if (short) illegal(`the bank has no ${short} left`);

  const gave = splitCards(offer.give);
  const got = splitCards(offer.receive);
  const next: GameState = {
    ...state,
    bank: subtractResources(addResources(state.bank, gave.resources), got.resources),
    commodityBank: subtractCommodities(addCommodities(state.commodityBank, gave.commodities), got.commodities),
    players: state.players.map((p) => (p.id === playerId ? playerPlus(playerMinus(p, offer.give), offer.receive) : p)),
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
  if (offerHasCommodities(offer) && !ruleSet.citiesAndKnights) {
    illegal("there are no commodities in this rule set");
  }
  for (const card of CARDS) {
    if ((offer.give[card] ?? 0) < 0 || (offer.receive[card] ?? 0) < 0) illegal("a trade cannot carry negative amounts");
  }

  if (offer.toPlayerId === undefined) return bankTrade(state, ruleSet, playerId, offer);

  if (offer.toPlayerId === playerId) illegal("you cannot trade with yourself");
  requirePlayer(state, offer.toPlayerId);
  if (state.pendingTrade) illegal("there is already a trade on the table");
  if (totalAllCards(offer.give) === 0 && (offer.giveDevCards?.length ?? 0) === 0) {
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

  if (!playerHolds(proposer, offer.give)) illegal("the proposer no longer holds their side");
  if (!playerHolds(responder, offer.receive)) illegal("you don't hold your side of the trade");

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
          ...playerPlus(playerMinus(p, offer.give), offer.receive),
          devCards: [...removeDevCards(p.devCards, giveDevCards), ...receiveDevCards],
        };
      }
      if (p.id === playerId) {
        return {
          ...playerPlus(playerMinus(p, offer.receive), offer.give),
          devCards: [...removeDevCards(p.devCards, receiveDevCards), ...giveDevCards],
        };
      }
      return p;
    }),
  };

  return refresh(next, ruleSet, offer.fromPlayerId);
}
