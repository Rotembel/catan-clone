// SPEC.md §6: "apply the same action log to the same seed twice -> identical
// state." This is the property the whole server-authoritative design leans
// on, so it's tested end to end rather than on the RNG alone.

import { describe, expect, it } from "vitest";
import type { ActionEnvelope, GameState } from "@catan/shared";
import { apply } from "../src/apply.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { newGame, testRuleSet } from "./fixtures.js";

const ruleSet = testRuleSet();

/**
 * Plays a fixed number of steps by always taking the same indexed choice
 * from the legal list — no randomness of its own, so any divergence between
 * runs comes from the engine.
 */
function playScript(seed: string, steps: number): { state: GameState; log: ActionEnvelope[] } {
  let state = newGame(ruleSet, ["Ada", "Grace", "Alan"], seed);
  const log: ActionEnvelope[] = [];

  for (let i = 0; i < steps && state.winner === undefined; i++) {
    // Whoever owes a discard goes first; otherwise the player to move.
    const pending = state.pendingDiscards ?? [];
    const playerId = pending[0] ?? state.players[state.turn.current]!.id;
    const options = legalActions(state, ruleSet, playerId);
    if (options.length === 0) break;
    const action = options[i % options.length]!;
    const envelope: ActionEnvelope = { playerId, action };
    state = apply(state, envelope, ruleSet);
    log.push(envelope);
  }

  return { state, log };
}

describe("determinism", () => {
  it("produces identical state from the same seed and the same choices", () => {
    const a = playScript("determinism-seed", 120);
    const b = playScript("determinism-seed", 120);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.log).toEqual(b.log);
  });

  it("replaying a recorded action log rebuilds the exact same state", () => {
    const { state: original, log } = playScript("replay-seed", 120);

    let replayed = newGame(ruleSet, ["Ada", "Grace", "Alan"], "replay-seed");
    for (const envelope of log) {
      replayed = apply(replayed, envelope, ruleSet);
    }

    expect(JSON.stringify(replayed)).toBe(JSON.stringify(original));
  });

  it("diverges on a different seed", () => {
    const a = playScript("seed-one", 120);
    const b = playScript("seed-two", 120);
    expect(JSON.stringify(a.state)).not.toBe(JSON.stringify(b.state));
  });
});
