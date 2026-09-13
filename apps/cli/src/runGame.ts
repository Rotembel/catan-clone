// Drives a complete bot-vs-bot game through the engine. This is the Phase 1
// local harness: no network, no UI — just the reducer, played end to end.

import { apply, createInitialState, createRng, totalVictoryPoints, type RngState } from "@catan/engine";
import { createRuleSet } from "@catan/rulesets";
import type { ActionEnvelope, GameState, RuleSet } from "@catan/shared";
import { chooseAction, nextActor } from "@catan/bot";

export interface RunGameOptions {
  seed?: string;
  /** Registry id; default "base". */
  ruleSetId?: string;
  victoryPoints?: number;
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


export function runGame(options: RunGameOptions = {}): GameResult {
  const seed = options.seed ?? "game-1";
  const playerNames = options.playerNames ?? ["Ada", "Grace", "Alan", "Edsger"];
  if (playerNames.length < 2) throw new Error("a game needs at least 2 players");
  const maxActions = options.maxActions ?? 20000;

  const { ruleSet, state: afterBoard } = createRuleSet(options.ruleSetId, { seed, victoryPoints: options.victoryPoints });
  let state = createInitialState(ruleSet, { playerNames, rngState: afterBoard });

  // The bots' own randomness, kept separate from the game's.
  let botRng: RngState = createRng(`${seed}-bots`);

  const log: ActionEnvelope[] = [];
  let actions = 0;

  while (state.winner === undefined && actions < maxActions) {
    const playerId = nextActor(state)!;
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
