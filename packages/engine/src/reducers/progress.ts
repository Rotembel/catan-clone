// Playing and discarding progress cards. The card registry does the
// card-specific work; this file only handles hand, timing and phase flow.

import type { GameState, RuleSet } from "@catan/shared";
import { discardProgressCardToPile, progressCardDef } from "../progress/deck.js";
import { progressCardImpl } from "../progress/registry.js";
import { resolveRoll } from "./dice.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase, requirePlayer, updatePlayer } from "./helpers.js";

function removeOne(cards: string[], id: string): string[] {
  const i = cards.indexOf(id);
  return i < 0 ? cards : [...cards.slice(0, i), ...cards.slice(i + 1)];
}

/** Ids of the cards this player may play right now, with their legal payloads. */
export function playableProgressCards(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number
): { cardId: string; payloads: unknown[] }[] {
  const ck = ruleSet.citiesAndKnights;
  const player = state.players.find((p) => p.id === playerId);
  if (!ck || !player) return [];
  if (state.players[state.turn.current]?.id !== playerId) return [];
  const out: { cardId: string; payloads: unknown[] }[] = [];
  for (const cardId of [...new Set(player.progressCards)]) {
    const def = progressCardDef(ruleSet, cardId);
    const impl = progressCardImpl(cardId);
    if (!def || !impl || def.timing === "immediate") continue;
    const phaseOk = def.timing === "beforeRoll" ? state.turn.phase === "rollDice" : state.turn.phase === "mainTurn";
    if (!phaseOk) continue;
    const payloads = impl.options(state, ruleSet, playerId);
    if (payloads.length > 0) out.push({ cardId, payloads });
  }
  return out;
}

export function playProgressCard(state: GameState, ruleSet: RuleSet, playerId: number, cardId: string, payload: unknown): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("progress cards are not part of this rule set");
  const def = progressCardDef(ruleSet, cardId);
  if (!def) illegal(`no such progress card: ${cardId}`);
  if (def.timing === "immediate") illegal(`${cardId} resolves when drawn and is never played`);
  const impl = progressCardImpl(cardId);
  if (!impl) illegal(`no such progress card: ${cardId}`);
  if (def.timing === "beforeRoll") requirePhase(state, "rollDice");
  else requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);
  const player = requirePlayer(state, playerId);
  if (!player.progressCards.includes(cardId)) illegal(`you do not hold ${cardId}`);

  // Card leaves the hand first, so an effect can never see itself.
  let next = updatePlayer(state, playerId, (p) => ({ ...p, progressCards: removeOne(p.progressCards, cardId) }));
  next = discardProgressCardToPile(next, def.category, cardId);
  next = impl.apply(next, ruleSet, playerId, payload);
  return refresh(next, ruleSet, playerId);
}

export function discardProgressCard(state: GameState, ruleSet: RuleSet, playerId: number, cardId: string): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) illegal("progress cards are not part of this rule set");
  requirePhase(state, "progressDiscard");
  const pending = state.pendingProgressDiscards ?? [];
  if (!pending.includes(playerId)) illegal(`player ${playerId} does not owe a progress discard`);
  const player = requirePlayer(state, playerId);
  if (!player.progressCards.includes(cardId)) illegal(`you do not hold ${cardId}`);
  const def = progressCardDef(ruleSet, cardId);
  if (!def) illegal(`no such progress card: ${cardId}`);

  let next = updatePlayer(state, playerId, (p) => ({ ...p, progressCards: removeOne(p.progressCards, cardId) }));
  next = discardProgressCardToPile(next, def.category, cardId);

  const stillOver = next.players.find((p) => p.id === playerId)!.progressCards.length > ck.progressHandLimit;
  const remaining = stillOver ? pending : pending.filter((id) => id !== playerId);
  if (remaining.length > 0) return refresh({ ...next, pendingProgressDiscards: remaining }, ruleSet);

  // Everyone is back within the limit; the roll that dealt the cards resolves.
  next = { ...next, pendingProgressDiscards: undefined, turn: { ...next.turn, phase: "rollDice" } };
  return resolveRoll(next, ruleSet);
}
