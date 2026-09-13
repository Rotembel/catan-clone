// Phase 1's actual milestone (SPEC.md §7): "a base game is fully playable".
// These run complete games through the real reducer and check both the
// outcome and the invariants that should hold across every state it passed
// through.

import { describe, expect, it } from "vitest";
import {
  COMMODITIES,
  RESOURCES,
  getGeometry,
  pieceCounts,
  pieceLimitsOf,
  totalCards,
  totalCommodities,
  totalVictoryPoints,
} from "@catan/engine";
import type { GameState, RuleSet } from "@catan/shared";
import { runGame } from "../src/runGame.js";

const SEEDS = ["alpha", "beta", "gamma", "delta"];

/** Every resource card ever printed is either in the bank or in a hand. */
function totalResourcesInPlay(state: GameState): number {
  return (
    totalCards(state.bank) + state.players.reduce((sum, p) => sum + totalCards(p.resources), 0)
  );
}

/** Likewise every commodity card. */
function totalCommoditiesInPlay(state: GameState): number {
  return (
    totalCommodities(state.commodityBank) +
    state.players.reduce((sum, p) => sum + totalCommodities(p.commodities), 0)
  );
}

function assertInvariants(
  state: GameState,
  ruleSet: RuleSet,
  expectedResources: number,
  expectedCommodities = 0
): void {
  expect(totalResourcesInPlay(state)).toBe(expectedResources);
  expect(totalCommoditiesInPlay(state)).toBe(expectedCommodities);

  for (const r of RESOURCES) {
    expect(state.bank[r]).toBeGreaterThanOrEqual(0);
    for (const p of state.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0);
  }
  for (const c of COMMODITIES) {
    expect(state.commodityBank[c]).toBeGreaterThanOrEqual(0);
    for (const p of state.players) expect(p.commodities[c]).toBeGreaterThanOrEqual(0);
  }

  const limits = pieceLimitsOf(ruleSet);
  for (const p of state.players) {
    const counts = pieceCounts(state, p.id);
    expect(counts.roads).toBeLessThanOrEqual(limits.roads);
    expect(counts.settlements).toBeLessThanOrEqual(limits.settlements);
    expect(counts.cities).toBeLessThanOrEqual(limits.cities);
  }

  // The distance rule must hold for the whole board, not just at placement.
  const geometry = getGeometry(ruleSet.board);
  for (const [vertex, building] of Object.entries(state.board.buildings)) {
    if (!building) continue;
    for (const neighbor of geometry.vertexNeighbors.get(vertex) ?? []) {
      expect(state.board.buildings[neighbor]).toBeUndefined();
    }
  }
}

describe("a full base game", () => {
  it("plays to victory", () => {
    const result = runGame({ seed: "alpha" });
    expect(result.exhausted).toBe(false);
    expect(result.winner).toBeDefined();

    const vp = totalVictoryPoints(result.state, result.ruleSet, result.winner!);
    expect(vp).toBeGreaterThanOrEqual(result.ruleSet.victoryPoints);
    expect(result.state.turn.phase).toBe("gameOver");
  });

  it.each(SEEDS)("finishes and holds its invariants throughout (seed %s)", (seed) => {
    const startingResources = 19 * RESOURCES.length;
    let checked = 0;

    const result = runGame({
      seed,
      onAction: (_envelope, state, ruleSet) => {
        // Checking every intermediate state is the point — this is the
        // cheapest place to catch a reducer that leaks or duplicates cards.
        assertInvariants(state, ruleSet, startingResources);
        checked++;
      },
    });

    expect(checked).toBeGreaterThan(50);
    expect(result.winner).toBeDefined();
  });

  it("is reproducible: the same seed replays to the same game", () => {
    const a = runGame({ seed: "repeatable" });
    const b = runGame({ seed: "repeatable" });
    expect(a.winner).toBe(b.winner);
    expect(a.actions).toBe(b.actions);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it("gives different games on different seeds", () => {
    const a = runGame({ seed: "one" });
    const b = runGame({ seed: "two" });
    expect(JSON.stringify(a.state)).not.toBe(JSON.stringify(b.state));
  });

  it("uses the real base board: 19 hexes, 9 ports, 25 dev cards", () => {
    const { ruleSet, state } = runGame({ seed: "board-check", maxActions: 1 });
    expect(ruleSet.board.hexes).toHaveLength(19);
    expect(ruleSet.board.hexes.filter((h) => h.resource === "desert")).toHaveLength(1);
    expect(ruleSet.board.ports).toHaveLength(9);
    expect(state.devDeck.length + 0).toBe(25);
    expect(state.board.robberHex).toBe(ruleSet.board.hexes.find((h) => h.resource === "desert")!.id);
  });

  it.each(SEEDS)("Cities & Knights (slices 1-2) finishes at 13 points with cards conserved (seed %s)", (seed) => {
    const startingResources = 19 * RESOURCES.length;
    const startingCommodities = 12 * COMMODITIES.length;
    let improvementsBuilt = 0;
    let knightsBuilt = 0;
    let attacks = 0;
    let commoditiesSeen = false;
    let checkedSetupCities = false;
    let lastShip = 0;

    const result = runGame({
      seed,
      ruleSetId: "cities-and-knights",
      onAction: (envelope, state, ruleSet) => {
        assertInvariants(state, ruleSet, startingResources, startingCommodities);
        if (envelope.action.type === "buildImprovement") improvementsBuilt++;
        if (envelope.action.type === "buildKnight") knightsBuilt++;
        if (state.players.some((p) => totalCommodities(p.commodities) > 0)) commoditiesSeen = true;
        // Everyone leaves setup with a city (the second placement).
        if (!checkedSetupCities && !state.turn.phase.startsWith("setup")) {
          for (const p of state.players) expect(pieceCounts(state, p.id).cities).toBe(1);
          checkedSetupCities = true;
        }
        // The ship only ever steps forward by one, or sails home after an attack.
        expect(state.barbarianPosition).toBeLessThan(ruleSet.citiesAndKnights!.barbarianTrackLength);
        if (state.barbarianPosition < lastShip) attacks++;
        else expect(state.barbarianPosition - lastShip).toBeLessThanOrEqual(1);
        lastShip = state.barbarianPosition;
        // Knights only ever stand on vertices of this board, never on a building.
        for (const [v, k] of Object.entries(state.board.knights)) {
          if (!k) continue;
          expect(getGeometry(ruleSet.board).vertexHexes.has(v)).toBe(true);
          expect(state.board.buildings[v]).toBeUndefined();
        }
      },
    });

    expect(result.exhausted).toBe(false);
    expect(result.winner).toBeDefined();
    expect(result.ruleSet.victoryPoints).toBe(13);
    expect(totalVictoryPoints(result.state, result.ruleSet, result.winner!)).toBeGreaterThanOrEqual(13);
    expect(checkedSetupCities).toBe(true);
    // The expansion actually happened: commodities flowed, improvements and
    // knights were bought, and the barbarians landed at least once.
    expect(commoditiesSeen).toBe(true);
    expect(improvementsBuilt).toBeGreaterThan(0);
    expect(knightsBuilt).toBeGreaterThan(0);
    expect(attacks).toBeGreaterThan(0);
  });

  it.each(SEEDS)("Home Large — 5 Seats: 5 players finish at 13 on the generated map (seed %s)", (seed) => {
    const startingResources = 19 * RESOURCES.length;
    let setupChecked = false;

    const result = runGame({
      seed,
      ruleSetId: "home-large-5",
      playerNames: ["Human A", "Human B", "Human C", "Bot 1", "Bot 2"],
      maxActions: 40000,
      onAction: (_envelope, state, ruleSet) => {
        assertInvariants(state, ruleSet, startingResources);
        if (!setupChecked && !state.turn.phase.startsWith("setup")) {
          for (const p of state.players) expect(pieceCounts(state, p.id).settlements).toBe(3);
          expect(Object.keys(state.board.roads)).toHaveLength(15);
          setupChecked = true;
        }
      },
    });

    expect(result.ruleSet.board.hexes).toHaveLength(37);
    expect(result.ruleSet.mapgen?.generationVersion).toBe("mapgen-v1");
    expect(setupChecked).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.winner).toBeDefined();
    expect(totalVictoryPoints(result.state, result.ruleSet, result.winner!)).toBeGreaterThanOrEqual(13);
  });
});
