// Event-die distribution and the hand limit.

import type { GameState, ImprovementTrack, RuleSet } from "@catan/shared";
import { updatePlayer } from "../reducers/helpers.js";
import { discardProgressCardToPile, drawProgressCard, progressCardDef } from "./deck.js";

/** The red die is the first production die. */
export function redDie(state: GameState): number {
  return state.dice?.[0] ?? 0;
}

/**
 * Official eligibility: a player receives a card of the rolled gate's
 * category when their improvement level in that track is at least 1 and
 * the red die is at most level + 1.
 */
export function eligibleForProgressCard(level: number, red: number): boolean {
  return level >= 1 && red <= level + 1;
}

/** Players who draw, in draw order: the roller first, then seat order. */
export function progressDrawOrder(state: GameState, ruleSet: RuleSet, track: ImprovementTrack): number[] {
  const n = state.players.length;
  const red = redDie(state);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = state.players[(state.turn.current + i) % n]!;
    if (eligibleForProgressCard(p.improvements[track], red)) order.push(p.id);
  }
  void ruleSet;
  return order;
}

/**
 * Give one card of `track` to each eligible player. Victory-point cards are
 * resolved on the spot; anyone now over the hand limit goes into
 * `pendingProgressDiscards` and the phase becomes "progressDiscard" (the
 * caller resumes the roll once they have chosen).
 */
export function distributeProgressCards(state: GameState, ruleSet: RuleSet, track: ImprovementTrack): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return state;
  let next = state;
  for (const playerId of progressDrawOrder(state, ruleSet, track)) {
    const drawn = drawProgressCard(next, track);
    next = drawn.state;
    if (!drawn.card) continue;
    const def = progressCardDef(ruleSet, drawn.card);
    if (def?.timing === "immediate") {
      next = updatePlayer(next, playerId, (p) => ({ ...p, progressVictoryPoints: p.progressVictoryPoints + 1 }));
      next = discardProgressCardToPile(next, track, drawn.card);
    } else {
      next = updatePlayer(next, playerId, (p) => ({ ...p, progressCards: [...p.progressCards, drawn.card!] }));
    }
  }
  const over = next.players.filter((p) => p.progressCards.length > ck.progressHandLimit).map((p) => p.id);
  if (over.length > 0) {
    next = { ...next, pendingProgressDiscards: over, turn: { ...next.turn, phase: "progressDiscard" } };
  }
  return next;
}
