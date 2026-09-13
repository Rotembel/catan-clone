// Presentation pacing for server-driven bot turns. Pure: given what the bot
// is about to do and what just happened, how long to wait before applying.
//
// This is *scheduling only*. The engine is untouched, RNG is consumed only by
// the authoritative action itself, and nothing here is ever written into
// GameState — a room restart simply re-chooses the same deterministic move.

import type { Action } from "@catan/shared";

export interface BotPacing {
  /** Bot's turn starts: pause before its rollDice. */
  beforeRollMs: number;
  /** Keep the dice/event result on screen before the bot's first action. */
  afterRollMs: number;
  /** Between two visible bot actions (build, trade, knight, ...). */
  betweenActionsMs: number;
  /** Pause before the bot ends its turn. */
  beforeEndTurnMs: number;
  /** Mandatory answers on someone else's turn (discard, decline a trade, respond to a card). */
  responseMs: number;
}

/** The HOME / LIVE defaults (SPEC: humans must be able to follow a bot's turn). */
export const HOME_BOT_PACING: BotPacing = {
  beforeRollMs: 800,
  afterRollMs: 1100,
  betweenActionsMs: 650,
  beforeEndTurnMs: 550,
  responseMs: 650,
};

/** Everything at once — for tests and headless runs. */
export const INSTANT_BOT_PACING: BotPacing = {
  beforeRollMs: 0,
  afterRollMs: 0,
  betweenActionsMs: 0,
  beforeEndTurnMs: 0,
  responseMs: 0,
};

/** Legacy single-knob override (BOT_DELAY_MS): every pause is that long. */
export function uniformBotPacing(ms: number): BotPacing {
  return { beforeRollMs: ms, afterRollMs: ms, betweenActionsMs: ms, beforeEndTurnMs: ms, responseMs: ms };
}

const RESPONSES = new Set<Action["type"]>(["discardCards", "respondTrade", "respondInteraction", "downgradeCity", "discardProgressCard", "placeMetropolis"]);

/**
 * Delay before applying `next` for a bot, given the previous applied action in
 * the room (undefined right after a restart / at game start).
 */
export function botDelayFor(pacing: BotPacing, next: Action, previous: Action | undefined, previousWasSameBot: boolean): number {
  if (next.type === "rollDice") return pacing.beforeRollMs;
  if (RESPONSES.has(next.type)) return pacing.responseMs;
  const afterOwnRoll = previousWasSameBot && previous?.type === "rollDice";
  if (next.type === "endTurn") return (afterOwnRoll ? pacing.afterRollMs : 0) + pacing.beforeEndTurnMs;
  return afterOwnRoll ? pacing.afterRollMs : pacing.betweenActionsMs;
}

export function pacingFromEnv(env: NodeJS.ProcessEnv): BotPacing {
  if (env.BOT_DELAY_MS !== undefined && env.BOT_DELAY_MS !== "") return uniformBotPacing(Number(env.BOT_DELAY_MS));
  const num = (key: string, fallback: number) => (env[key] !== undefined && env[key] !== "" ? Number(env[key]) : fallback);
  return {
    beforeRollMs: num("BOT_BEFORE_ROLL_MS", HOME_BOT_PACING.beforeRollMs),
    afterRollMs: num("BOT_AFTER_ROLL_MS", HOME_BOT_PACING.afterRollMs),
    betweenActionsMs: num("BOT_BETWEEN_ACTIONS_MS", HOME_BOT_PACING.betweenActionsMs),
    beforeEndTurnMs: num("BOT_BEFORE_END_TURN_MS", HOME_BOT_PACING.beforeEndTurnMs),
    responseMs: num("BOT_RESPONSE_MS", HOME_BOT_PACING.responseMs),
  };
}
