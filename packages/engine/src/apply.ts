// apply(state, action, ruleSet) -> newState (SPEC.md §1).
//
// Pure and deterministic: no Date.now(), no Math.random(). Randomness comes
// from state.rngState, which every randomising reducer threads forward.
// Illegal actions throw and leave the input state untouched.

import type { ActionEnvelope, GameState, RuleSet } from "@catan/shared";
import { buildCity, buildRoad, buildSettlement } from "./reducers/build.js";
import { buyDevCard, playDevCard } from "./reducers/devCards.js";
import { discardCards, rollDice } from "./reducers/dice.js";
import { buildImprovement } from "./reducers/improve.js";
import { downgradeCity } from "./reducers/barbarians.js";
import { activateKnight, buildKnight, moveKnight, promoteKnight } from "./reducers/knights.js";
import { IllegalActionError, illegal, requireInPlay, requirePlayer } from "./reducers/helpers.js";
import { moveRobber } from "./reducers/robber.js";
import { placeSetupRoad, placeSetupSettlement } from "./reducers/setup.js";
import { proposeTrade, respondTrade } from "./reducers/trade.js";
import { endTurn } from "./reducers/turn.js";

export { IllegalActionError };

function isSetupPhase(state: GameState): boolean {
  return state.turn.phase.startsWith("setup");
}

export function apply(state: GameState, action: ActionEnvelope, ruleSet: RuleSet): GameState {
  requireInPlay(state);
  const { playerId } = action;
  requirePlayer(state, playerId);

  switch (action.action.type) {
    case "rollDice":
      return rollDice(state, ruleSet, playerId);

    case "buildRoad":
      return isSetupPhase(state)
        ? placeSetupRoad(state, ruleSet, playerId, action.action.edge)
        : buildRoad(state, ruleSet, playerId, action.action.edge);

    case "buildSettlement":
      return isSetupPhase(state)
        ? placeSetupSettlement(state, ruleSet, playerId, action.action.vertex)
        : buildSettlement(state, ruleSet, playerId, action.action.vertex);

    case "buildCity":
      return buildCity(state, ruleSet, playerId, action.action.vertex);

    case "buyDevCard":
      return buyDevCard(state, ruleSet, playerId);

    case "playDevCard":
      return playDevCard(state, ruleSet, playerId, action.action.cardId, action.action.payload);

    case "proposeTrade":
      return proposeTrade(state, ruleSet, playerId, action.action.offer);

    case "respondTrade":
      return respondTrade(state, ruleSet, playerId, action.action.accept);

    case "moveRobber":
      return moveRobber(state, ruleSet, playerId, action.action.hex, action.action.stealFrom);

    case "discardCards":
      return discardCards(state, ruleSet, playerId, action.action.discard);

    case "buildImprovement":
      return buildImprovement(state, ruleSet, playerId, action.action.track);

    case "buildKnight":
      return buildKnight(state, ruleSet, playerId, action.action.vertex);

    case "activateKnight":
      return activateKnight(state, ruleSet, playerId, action.action.vertex);

    case "promoteKnight":
      return promoteKnight(state, ruleSet, playerId, action.action.vertex);

    case "moveKnight":
      return moveKnight(state, ruleSet, playerId, action.action.from, action.action.to);

    case "downgradeCity":
      return downgradeCity(state, ruleSet, playerId, action.action.vertex);

    case "endTurn":
      return endTurn(state, ruleSet, playerId);

    default: {
      const exhaustive: never = action.action;
      return illegal(`unknown action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: IllegalActionError };

/** Non-throwing `apply`, for probing legality (UI hints, bots, tests). */
export function tryApply(state: GameState, action: ActionEnvelope, ruleSet: RuleSet): ApplyResult {
  try {
    return { ok: true, state: apply(state, action, ruleSet) };
  } catch (error) {
    if (error instanceof IllegalActionError) return { ok: false, error };
    throw error;
  }
}
