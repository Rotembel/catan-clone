// The response queue itself — kept apart from the registry so that card
// and interaction modules can import it without a circular import.

import type { GameState, PendingInteraction, RuleSet } from "@catan/shared";
import { illegal } from "../reducers/helpers.js";

export interface InteractionModule {
  /** Every legal answer for the current responder (bounded). */
  options(state: GameState, ruleSet: RuleSet, responderId: number, interaction: PendingInteraction): unknown[];
  /**
   * Apply the answer. Return the new state; leave `pendingInteraction`
   * untouched to let the queue advance, or set a *new* one to chain.
   */
  respond(state: GameState, ruleSet: RuleSet, responderId: number, interaction: PendingInteraction, payload: unknown): GameState;
}

/** Queue a response. With no responders nothing happens and play continues. */
export function startInteraction(
  state: GameState,
  interaction: Omit<PendingInteraction, "currentResponder" | "returnPhase"> & { returnPhase?: PendingInteraction["returnPhase"] }
): GameState {
  const responders = interaction.responders.filter((id, i, all) => all.indexOf(id) === i);
  if (responders.length === 0) return state;
  if (state.pendingInteraction) illegal("another response is already in progress");
  return {
    ...state,
    pendingInteraction: {
      ...interaction,
      responders,
      currentResponder: responders[0]!,
      returnPhase: interaction.returnPhase ?? (state.turn.phase === "respond" ? "mainTurn" : state.turn.phase),
    },
    turn: { ...state.turn, phase: "respond" },
  };
}

/** Pop the current responder; resume the source's phase when the queue is empty. */
export function advanceInteraction(state: GameState): GameState {
  const pi = state.pendingInteraction;
  if (!pi) return state;
  const remaining = pi.responders.slice(1);
  if (remaining.length > 0) {
    return { ...state, pendingInteraction: { ...pi, responders: remaining, currentResponder: remaining[0]! } };
  }
  return { ...state, pendingInteraction: undefined, turn: { ...state.turn, phase: pi.returnPhase } };
}
