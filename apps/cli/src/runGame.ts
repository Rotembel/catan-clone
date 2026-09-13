// Drives a complete bot-vs-bot game through the engine. This is the Phase 1
// local harness: no network, no UI — just the reducer, played end to end.

import { apply, createInitialState, createRng, totalVictoryPoints, type RngState } from "@catan/engine";
import { createRuleSet } from "@catan/rulesets";
import type { ActionEnvelope, GameState, RuleSet } from "@catan/shared";
import { chooseAction } from "./bot.js";

export interface RunGameOptions {
  seed?: string;
  /** Registry id; default "base". */
  ruleSetId?: string;
  playerNames?: string[];
  /** Safety valve: a game that can't finish shouldn't hang the process. */
  maxActions?: number;
  onAction?: (envelope: ActionEnvelope, state: GameState, ruleSet: RuleSet) => void;
}

export interface GameResult {
  ruleSet: RuleSet;
  state: GameState;
  actions: number;
  log: ActionEnvelope[];
  winner: number | undefined;
  /** True if the game stopped because it hit maxActions rather than finishing. */
  exhausted: boolean;
}

/** Whoever must act next: a player owing a discard, else the player to move. */
function actorFor(state: GameState): number {
  const pending = state.pendingDiscards ?? [];
  if (pending.length > 0) return pending[0]!;
  const downgrades = state.pendingDowngrades ?? [];
  if (downgrades.length > 0) return downgrades[0]!;
  if (state.pendingTrade?.toPlayerId !== undefined) return state.pendingTrade.toPlayerId;
  return state.players[state.turn.current]!.id;
}

export function runGame(options: RunGameOptions = {}): GameResult {
  const seed = options.seed ?? "game-1";
  const playerNames = options.playerNames ?? ["Ada", "Grace", "Alan", "Edsger"];
  const maxActions = options.maxActions ?? 20000;

  const { ruleSet, state: afterBoard } = createRuleSet(options.ruleSetId, { seed });
  let state = createInitialState(ruleSet, { playerNames, rngState: afterBoard });

  // The bots' own randomness, kept separate from the game's.
  let botRng: RngState = createRng(`${seed}-bots`);

  const log: ActionEnvelope[] = [];
  let actions = 0;

  while (state.winner === undefined && actions < maxActions) {
    const playerId = actorFor(state);
    const choice = chooseAction(state, ruleSet, playerId, botRng);
    botRng = choice.rng;
    if (!choice.action) break;

    const envelope: ActionEnvelope = { playerId, action: choice.action };
    state = apply(state, envelope, ruleSet);
    log.push(envelope);
    actions++;
    options.onAction?.(envelope, state, ruleSet);
  }

  return {
    ruleSet,
    state,
    actions,
    log,
    winner: state.winner,
    exhausted: state.winner === undefined,
  };
}

export function scoreboard(state: GameState, ruleSet: RuleSet): string[] {
  return state.players.map((p) => {
    const total = totalVictoryPoints(state, ruleSet, p.id);
    const marks = [
      state.longestRoadPlayerId === p.id ? "longest road" : null,
      state.largestArmyPlayerId === p.id ? `largest army (${p.playedKnights})` : null,
    ].filter(Boolean);
    const suffix = marks.length > 0 ? ` — ${marks.join(", ")}` : "";
    return `${p.name}: ${total} VP${suffix}`;
  });
}
