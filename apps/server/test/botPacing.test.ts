import { describe, expect, it } from "vitest";
import { HOME_BOT_PACING, INSTANT_BOT_PACING, botDelayFor, pacingFromEnv, uniformBotPacing } from "../src/botPacing.js";

const P = HOME_BOT_PACING;
const roll = { type: "rollDice" as const };
const road = { type: "buildRoad" as const, edge: "e:1" };
const end = { type: "endTurn" as const };

describe("bot pacing (presentation only)", () => {
  it("home defaults sit in the agreed windows", () => {
    expect(P.beforeRollMs).toBeGreaterThanOrEqual(600); expect(P.beforeRollMs).toBeLessThanOrEqual(900);
    expect(P.afterRollMs).toBeGreaterThanOrEqual(900); expect(P.afterRollMs).toBeLessThanOrEqual(1200);
    expect(P.betweenActionsMs).toBeGreaterThanOrEqual(500); expect(P.betweenActionsMs).toBeLessThanOrEqual(800);
    expect(P.beforeEndTurnMs).toBeGreaterThanOrEqual(400); expect(P.beforeEndTurnMs).toBeLessThanOrEqual(700);
  });

  it("turn shape: pause → roll → dice stay up → action → pause → ... → end turn", () => {
    expect(botDelayFor(P, roll, end, false)).toBe(P.beforeRollMs);
    expect(botDelayFor(P, road, roll, true)).toBe(P.afterRollMs); // first action after own roll
    expect(botDelayFor(P, road, road, true)).toBe(P.betweenActionsMs);
    expect(botDelayFor(P, end, road, true)).toBe(P.beforeEndTurnMs);
    // Roll then straight to end turn: the dice still get their time on screen.
    expect(botDelayFor(P, end, roll, true)).toBe(P.afterRollMs + P.beforeEndTurnMs);
    // Another player's roll is not "my" roll.
    expect(botDelayFor(P, road, roll, false)).toBe(P.betweenActionsMs);
    // Right after a restart nothing is known: plain between-actions pause.
    expect(botDelayFor(P, road, undefined, false)).toBe(P.betweenActionsMs);
  });

  it("mandatory answers (discard, trade reply, card response) use the response pause", () => {
    expect(botDelayFor(P, { type: "respondTrade", accept: false }, road, false)).toBe(P.responseMs);
    expect(botDelayFor(P, { type: "discardCards", discard: {} }, roll, false)).toBe(P.responseMs);
  });

  it("env: BOT_DELAY_MS keeps its legacy uniform meaning; per-phase keys override the defaults", () => {
    expect(pacingFromEnv({ BOT_DELAY_MS: "250" })).toEqual(uniformBotPacing(250));
    expect(pacingFromEnv({ BOT_DELAY_MS: "0" })).toEqual(INSTANT_BOT_PACING);
    expect(pacingFromEnv({})).toEqual(HOME_BOT_PACING);
    expect(pacingFromEnv({ BOT_AFTER_ROLL_MS: "2000" })).toEqual({ ...HOME_BOT_PACING, afterRollMs: 2000 });
  });
});
