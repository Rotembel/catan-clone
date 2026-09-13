// respondInteraction: the current responder answers; the module applies it;
// the queue advances (or the module chained a new interaction).

import type { GameState, RuleSet } from "@catan/shared";
import { INTERACTIONS, advanceInteraction } from "../interactions/index.js";
import { illegal, refresh, requirePhase, requirePlayer } from "./helpers.js";

export function interactionOptions(state: GameState, ruleSet: RuleSet, playerId: number): unknown[] {
  const pi = state.pendingInteraction;
  if (!pi || state.turn.phase !== "respond" || pi.currentResponder !== playerId) return [];
  return INTERACTIONS[pi.kind].options(state, ruleSet, playerId, pi);
}

export function respondInteraction(state: GameState, ruleSet: RuleSet, playerId: number, payload: unknown): GameState {
  if (!ruleSet.citiesAndKnights) illegal("there is nothing to respond to in this rule set");
  requirePhase(state, "respond");
  requirePlayer(state, playerId);
  const pi = state.pendingInteraction;
  if (!pi) illegal("there is no response pending");
  if (pi.currentResponder !== playerId) illegal(`it is player ${pi.currentResponder}'s response, not player ${playerId}'s`);

  let next = INTERACTIONS[pi.kind].respond(state, ruleSet, playerId, pi, payload);
  // Same queue → advance it; a chained interaction replaced it and is already live.
  if (next.pendingInteraction === pi) next = advanceInteraction(next);
  return refresh(next, ruleSet, pi.sourcePlayerId);
}
