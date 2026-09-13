import type { GameState, Player, RuleSet, TurnPhase } from "@catan/shared";
import { resolveLargestArmy, resolveLongestRoad } from "../selectors/awards.js";
import { expansionVictoryPoints, publicVictoryPoints, totalVictoryPoints } from "../selectors/victory.js";

/** Thrown when an action is not legal. State is never mutated before this throws. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

export function illegal(message: string): never {
  throw new IllegalActionError(message);
}

export function requirePlayer(state: GameState, playerId: number): Player {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) illegal(`no such player: ${playerId}`);
  return player;
}

export function requireCurrentPlayer(state: GameState, playerId: number): Player {
  const current = state.players[state.turn.current];
  if (!current || current.id !== playerId) {
    illegal(`it is not player ${playerId}'s turn`);
  }
  return current;
}

export function requirePhase(state: GameState, ...phases: TurnPhase[]): void {
  if (!phases.includes(state.turn.phase)) {
    illegal(`action not allowed during phase "${state.turn.phase}"`);
  }
}

export function requireInPlay(state: GameState): void {
  if (state.winner !== undefined || state.turn.phase === "gameOver") {
    illegal("the game is over");
  }
}

export function updatePlayer(
  state: GameState,
  playerId: number,
  update: (player: Player) => Player
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? update(p) : p)),
  };
}

/**
 * Recompute the two awards, everyone's public VP, and the winner.
 * Call at the end of any action that could move any of them.
 */
export function refresh(state: GameState, ruleSet: RuleSet, actingPlayerId?: number): GameState {
  let next: GameState = {
    ...state,
    longestRoadPlayerId: resolveLongestRoad(state, ruleSet),
    largestArmyPlayerId: resolveLargestArmy(state),
  };

  next = {
    ...next,
    players: next.players.map((p) => ({ ...p, victoryPoints: publicVictoryPoints(next, p.id) + expansionVictoryPoints(next, ruleSet, p.id) })),
  };

  if (actingPlayerId !== undefined && next.winner === undefined) {
    if (totalVictoryPoints(next, ruleSet, actingPlayerId) >= ruleSet.victoryPoints) {
      next = { ...next, winner: actingPlayerId, turn: { ...next.turn, phase: "gameOver" } };
    }
  }

  return next;
}

/** How many pieces of each kind the player has on the board. */
export function pieceCounts(state: GameState, playerId: number): {
  roads: number;
  settlements: number;
  cities: number;
} {
  let roads = 0;
  let settlements = 0;
  let cities = 0;
  for (const owner of Object.values(state.board.roads)) {
    if (owner === playerId) roads++;
  }
  for (const building of Object.values(state.board.buildings)) {
    if (building?.playerId !== playerId) continue;
    if (building.kind === "city") cities++;
    else settlements++;
  }
  return { roads, settlements, cities };
}

/** Standard base-game piece limits. */
export const PIECE_LIMITS = { roads: 15, settlements: 5, cities: 4 } as const;

/** The limits in force for a rule set (data first, base defaults otherwise). */
export function pieceLimitsOf(ruleSet: RuleSet): { roads: number; settlements: number; cities: number } {
  return ruleSet.pieceLimits ?? PIECE_LIMITS;
}
