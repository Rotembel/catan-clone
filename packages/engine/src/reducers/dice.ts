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
import { illegal, refresh, requireCurrentPlayer, requirePhase } from "./helpers.js";

/** Hand size (resources + commodities) above which a 7 forces a discard. */
export const DISCARD_THRESHOLD = 7;

export function rollDice(state: GameState, ruleSet: RuleSet, playerId: number): GameState {
  requirePhase(state, "rollDice");
  requireCurrentPlayer(state, playerId);

  const { dice, state: rngState } = rollTwoDice(state.rngState);
  let next: GameState = { ...state, dice, rngState, eventDie: undefined };

  // Cities & Knights: the event die rolls with the production dice, and a
  // barbarian face is resolved *before* production. The base game draws
  // nothing extra from the RNG, so its rolls are unchanged.
  const ck = ruleSet.citiesAndKnights;
  if (ck) {
    const { value, state: afterEvent } = nextInt(next.rngState, ck.eventDie.length);
    const face = ck.eventDie[value]!;
    next = { ...next, rngState: afterEvent, eventDie: face };
    if (face === "barbarian") next = advanceBarbarians(next, ruleSet);
    if (next.turn.phase === "barbarianDowngrade") return refresh(next, ruleSet);
  }

  return resolveRoll(next, ruleSet);
}

/** The production half of a roll: a 7, or a payout. `state.dice` must be set. */
export function resolveRoll(state: GameState, ruleSet: RuleSet): GameState {
  if (!state.dice) illegal("no dice to resolve");
  const roll = state.dice[0] + state.dice[1];
  let next: GameState = state;

  if (roll === 7) {
    const owing = next.players.filter((p) => handSize(p) > DISCARD_THRESHOLD).map((p) => p.id);
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

/** How many cards this player must discard (half, rounded down). */
export function discardCountFor(state: GameState, playerId: number): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  const hand = handSize(player);
  return hand > DISCARD_THRESHOLD ? Math.floor(hand / 2) : 0;
}

export function discardCards(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  discard: CardCounts
): GameState {
  requirePhase(state, "discard");
  const pending = state.pendingDiscards ?? [];
  if (!pending.includes(playerId)) illegal(`player ${playerId} does not owe a discard`);

  const player = state.players.find((p) => p.id === playerId)!;
  const required = discardCountFor(state, playerId);
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

  next =
    remaining.length > 0
      ? { ...next, pendingDiscards: remaining }
      : { ...next, pendingDiscards: undefined, turn: { ...next.turn, phase: "moveRobberAfterSeven" } };

  return refresh(next, ruleSet);
}

// Re-exported for callers that only ever dealt in resources.
export { playerPlus };
