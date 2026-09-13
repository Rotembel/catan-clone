import type { GameState } from "@catan/shared";

/**
 * Whoever must act next in this state: a player owing a discard, then a
 * player owing a city after a barbarian raid, then the target of a pending
 * trade, else the player whose turn it is. Undefined once the game is over.
 * Shared by the CLI harness and the server's bot controller so "is it a
 * bot's move?" has exactly one answer.
 */
export function nextActor(state: GameState): number | undefined {
  if (state.winner !== undefined || state.turn.phase === "gameOver") return undefined;
  const discards = state.pendingDiscards ?? [];
  if (discards.length > 0) return discards[0];
  const downgrades = state.pendingDowngrades ?? [];
  if (downgrades.length > 0) return downgrades[0];
  const progress = state.pendingProgressDiscards ?? [];
  if (progress.length > 0) return progress[0];
  if (state.pendingTrade?.toPlayerId !== undefined) return state.pendingTrade.toPlayerId;
  return state.players[state.turn.current]?.id;
}
