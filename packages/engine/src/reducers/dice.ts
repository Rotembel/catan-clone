// Rolling, production payout, and the 7-card discard.

import type { CardCounts, GameState, RuleSet } from "@catan/shared";
import {
  CARDS,
  addCommodities,
  addResources,
  handSize,
  playerMinus,
  playerPlus,
  splitCards,
  totalAllCards,
} from "../resources.js";
import { nextInt, rollTwoDice } from "../rng.js";
import { productionForRoll } from "../selectors/production.js";
import { advanceBarbarians } from "./barbarians.js";
import { distributeProgressCards } from "../progress/draw.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase } from "./helpers.js";

/** Hand size (resources + commodities) above which a 7 forces a discard. */
export const DISCARD_THRESHOLD = 7;

/** The player's own threshold: 7, plus the city-wall bonus per wall (Cities & Knights). */
export function discardThresholdFor(state: GameState, ruleSet: RuleSet, playerId: number): number {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return DISCARD_THRESHOLD;
  const walls = Object.values(state.board.walls).filter((o) => o === playerId).length;
  return DISCARD_THRESHOLD + walls * ck.wall.discardBonus;
}

export function rollDice(state: GameState, ruleSet: RuleSet, playerId: number): GameState {
  requirePhase(state, "rollDice");
  requireCurrentPlayer(state, playerId);

  // Alchemist: the production dice were chosen; nothing is drawn for them.
  let next: GameState;
  if (state.alchemistDice) {
    next = { ...state, dice: state.alchemistDice, alchemistDice: undefined, eventDie: undefined };
  } else {
    const { dice, state: rngState } = rollTwoDice(state.rngState);
    next = { ...state, dice, rngState, eventDie: undefined };
  }

  // Cities & Knights: the event die rolls with the production dice. A
  // barbarian face is resolved *before* production; a city-gate face deals
  // progress cards *before* production too, so both can pause the roll on a
  // player decision and resume it with resolveRoll. The base game draws
  // nothing extra from the RNG, so its rolls are unchanged.
  const ck = ruleSet.citiesAndKnights;
  if (ck) {
    const { value, state: afterEvent } = nextInt(next.rngState, ck.eventDie.length);
    const face = ck.eventDie[value]!;
    next = { ...next, rngState: afterEvent, eventDie: face };
    if (face === "barbarian") next = advanceBarbarians(next, ruleSet);
    else next = distributeProgressCards(next, ruleSet, face);
    if (next.turn.phase === "barbarianDowngrade" || next.turn.phase === "progressDiscard") return refresh(next, ruleSet);
  }

  return resolveRoll(next, ruleSet);
}

/** The production half of a roll: a 7, or a payout. `state.dice` must be set. */
export function resolveRoll(state: GameState, ruleSet: RuleSet): GameState {
  if (!state.dice) illegal("no dice to resolve");
  const roll = state.dice[0] + state.dice[1];
  let next: GameState = state;

  if (roll === 7) {
    const owing = next.players.filter((p) => handSize(p) > discardThresholdFor(next, ruleSet, p.id)).map((p) => p.id);
    if (owing.length > 0) {
      next = { ...next, pendingDiscards: owing, turn: { ...next.turn, phase: "discard" } };
    } else {
      next = { ...next, turn: { ...next.turn, phase: "moveRobberAfterSeven" } };
    }
    return refresh(next, ruleSet);
  }

  const { gains, commodityGains, bank, commodityBank } = productionForRoll(next, ruleSet, roll);
  next = {
    ...next,
    bank,
    commodityBank,
    players: next.players.map((p) => {
      const gain = gains.get(p.id);
      const cgain = commodityGains.get(p.id);
      if (!gain && !cgain) return p;
      return {
        ...p,
        resources: gain ? addResources(p.resources, gain) : p.resources,
        commodities: cgain ? addCommodities(p.commodities, cgain) : p.commodities,
      };
    }),
    turn: { ...next.turn, phase: "mainTurn" },
  };

  return refresh(next, ruleSet);
}

/**
 * How many cards this player must discard right now: their forced request
 * if one is pending (e.g. Saboteur), else half (rounded down) when over
 * their 7-roll threshold.
 */
export function discardCountFor(state: GameState, playerId: number, ruleSet?: RuleSet): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  if (state.turn.phase === "forcedDiscard") {
    return state.discardRequests?.find((r) => r.playerId === playerId)?.count ?? 0;
  }
  const hand = handSize(player);
  const threshold = ruleSet ? discardThresholdFor(state, ruleSet, playerId) : DISCARD_THRESHOLD;
  return hand > threshold ? Math.floor(hand / 2) : 0;
}

/** Owe `count` cards for `reason`; nothing happens for players owing 0. */
export function requestDiscards(state: GameState, requests: import("@catan/shared").DiscardRequest[]): GameState {
  const owed = requests.filter((r) => r.count > 0);
  if (owed.length === 0) return state;
  return { ...state, discardRequests: owed, turn: { ...state.turn, phase: "forcedDiscard" } };
}

export function discardCards(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  discard: CardCounts
): GameState {
  requirePhase(state, "discard", "forcedDiscard");
  const forced = state.turn.phase === "forcedDiscard";
  const pending = forced ? (state.discardRequests ?? []).map((r) => r.playerId) : (state.pendingDiscards ?? []);
  if (!pending.includes(playerId)) illegal(`player ${playerId} does not owe a discard`);

  const player = state.players.find((p) => p.id === playerId)!;
  const required = discardCountFor(state, playerId, ruleSet);
  if (totalAllCards(discard) !== required) {
    illegal(`player ${playerId} must discard exactly ${required} cards`);
  }
  for (const card of CARDS) {
    const amount = discard[card] ?? 0;
    if (amount < 0) illegal("cannot discard a negative amount");
    const held = card in player.resources ? player.resources[card as keyof typeof player.resources] : player.commodities[card as keyof typeof player.commodities];
    if (held < amount) illegal(`player ${playerId} does not hold ${amount} ${card}`);
  }

  const { resources, commodities } = splitCards(discard);
  const remaining = pending.filter((id) => id !== playerId);
  let next: GameState = {
    ...state,
    bank: addResources(state.bank, resources),
    commodityBank: addCommodities(state.commodityBank, commodities),
    players: state.players.map((p) => (p.id === playerId ? playerMinus(p, discard) : p)),
  };

  if (forced) {
    const requests = (state.discardRequests ?? []).filter((r) => r.playerId !== playerId);
    const returnPhase = state.discardRequests!.find((r) => r.playerId === playerId)!.returnPhase;
    next =
      requests.length > 0
        ? { ...next, discardRequests: requests }
        : { ...next, discardRequests: undefined, turn: { ...next.turn, phase: returnPhase } };
    return refresh(next, ruleSet);
  }

  next =
    remaining.length > 0
      ? { ...next, pendingDiscards: remaining }
      : { ...next, pendingDiscards: undefined, turn: { ...next.turn, phase: "moveRobberAfterSeven" } };

  return refresh(next, ruleSet);
}

// Re-exported for callers that only ever dealt in resources.
export { playerPlus };
