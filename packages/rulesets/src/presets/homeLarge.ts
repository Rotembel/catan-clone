// "Home Large — 5 Seats": the HOME STABLE v0.1 preset
// (docs/planning/HOME_LAN_VERSION_WRAP.md §8). Base-game mechanics on a
// generated 37-hex board, three opening placements each, 13 points to win
// (provisional, configurable). Starting resources come from the *second*
// settlement only, as in the base game — the third pays nothing (owner
// decision after the first Wi-Fi night). Piece limits are raised to match
// the bigger map and third placement — provisional, see HANDOFF.md.

import type { RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createRng } from "@catan/engine";
import { BASE_COSTS, BASE_DEV_CARDS, type BaseRuleSetOptions } from "../base.js";
import { generateBoard } from "../mapgen.js";

export const HOME_LARGE_ID = "home-large-5";

export const HOME_LARGE = {
  seats: 5,
  radius: 3,
  placementsPerSeat: 3,
  victoryPoints: 13,
  pieceLimits: { roads: 18, settlements: 7, cities: 5 },
  candidates: 250,
} as const;

export interface HomeLargeOptions extends BaseRuleSetOptions {
  victoryPoints?: number;
}

export function createHomeLargeRuleSet(options: HomeLargeOptions = {}): { ruleSet: RuleSet; state: RngState } {
  const seed = String(options.seed ?? "home");
  const { layout, info } = generateBoard({
    seed,
    radius: options.radius ?? HOME_LARGE.radius,
    seats: HOME_LARGE.seats,
    placementsPerSeat: HOME_LARGE.placementsPerSeat,
    candidates: HOME_LARGE.candidates,
  });

  const ruleSet: RuleSet = {
    id: HOME_LARGE_ID,
    victoryPoints: options.victoryPoints ?? HOME_LARGE.victoryPoints,
    maxPlayers: HOME_LARGE.seats,
    costs: BASE_COSTS,
    devCards: BASE_DEV_CARDS,
    board: layout,
    houseRules: { tradeDevCards: false },
    setup: {
      sequence: "snake",
      rounds: [
        { piece: "settlement", road: true },
        { piece: "settlement", road: true },
        { piece: "settlement", road: true },
      ],
      startingResourcesRound: 2,
    },
    pieceLimits: { ...HOME_LARGE.pieceLimits },
    mapgen: info,
  };

  // The game's own RNG continues from the board seed, like the base builder.
  return { ruleSet, state: createRng(`${seed}|game`) };
}
