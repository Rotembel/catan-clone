import type { GameState, RuleSet } from "@catan/shared";
import { refresh, requireCurrentPlayer, requirePhase } from "./helpers.js";
import { resetKnightTurnFlags } from "./knights.js";

export function endTurn(state: GameState, ruleSet: RuleSet, playerId: number): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  const nextIndex = (state.turn.current + 1) % state.players.length;
  const next: GameState = {
    ...resetKnightTurnFlags(state),
    dice: undefined,
    pendingTrade: undefined,
    // Per-turn dev card restrictions reset for everyone.
    players: state.players.map((p) => ({
      ...p,
      devCardsBoughtThisTurn: [],
      hasPlayedDevCardThisTurn: false,
      merchantFleet: undefined,
    })),
    turn: { current: nextIndex, phase: "rollDice" },
  };

  return refresh(next, ruleSet);
}
