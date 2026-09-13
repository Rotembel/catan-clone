// Cities & Knights (SPEC.md §7 Phase 5), delivered in slices. This is the
// base game plus the expansion block; each slice adds fields to that block
// and the engine branches on them. Slice 1: commodities and city
// improvements (second placement is a city; 13 points to win). Slice 2:
// the event die, the barbarian track and attack, and knights as pieces.
// Slice 3: progress cards dealt by the city-gate faces.

import type { CitiesAndKnightsRules, RuleSet } from "@catan/shared";
import type { RngState } from "@catan/engine";
import { createBaseRuleSet, type BaseRuleSetOptions } from "./base.js";

export const CITIES_AND_KNIGHTS_ID = "cities-and-knights";

export const CITIES_AND_KNIGHTS_RULES: CitiesAndKnightsRules = {
  commodityFor: { sheep: "cloth", ore: "coin", wood: "paper" },
  trackCommodity: { trade: "cloth", politics: "coin", science: "paper" },
  improvementCosts: [1, 2, 3, 4, 5],
  commodityPortLevel: 3,
  setupSecondPlacementIsCity: true,
  commodityBankPerType: 12,
  eventDie: ["barbarian", "barbarian", "barbarian", "trade", "politics", "science"],
  barbarianTrackLength: 7,
  knightCosts: {
    build: { sheep: 1, ore: 1 },
    activate: { wheat: 1 },
    promote: { sheep: 1, ore: 1 },
  },
  knightsPerLevel: 2,
  fortressLevel: 3,
  // Slice 3: only the cards the engine implements are in the decks (official
  // counts for those). Deferred cards are listed in HANDOFF.md.
  progressCards: [
    { id: "resourceMonopoly", label: "Resource Monopoly", category: "trade", count: 4, timing: "mainTurn" },
    { id: "tradeMonopoly", label: "Trade Monopoly", category: "trade", count: 2, timing: "mainTurn" },
    { id: "merchantFleet", label: "Merchant Fleet", category: "trade", count: 2, timing: "mainTurn" },
    { id: "bishop", label: "Bishop", category: "politics", count: 2, timing: "mainTurn" },
    { id: "warlord", label: "Warlord", category: "politics", count: 2, timing: "mainTurn" },
    { id: "spy", label: "Spy", category: "politics", count: 3, timing: "mainTurn" },
    { id: "constitution", label: "Constitution", category: "politics", count: 1, timing: "immediate" },
    { id: "irrigation", label: "Irrigation", category: "science", count: 2, timing: "mainTurn" },
    { id: "mining", label: "Mining", category: "science", count: 2, timing: "mainTurn" },
    { id: "roadBuilding", label: "Road Building", category: "science", count: 2, timing: "mainTurn" },
    { id: "inventor", label: "Inventor", category: "science", count: 2, timing: "mainTurn" },
    { id: "alchemist", label: "Alchemist", category: "science", count: 2, timing: "beforeRoll" },
    { id: "smith", label: "Smith", category: "science", count: 2, timing: "mainTurn" },
    { id: "printer", label: "Printer", category: "science", count: 1, timing: "immediate" },
    // slice 4
    { id: "merchant", label: "Merchant", category: "trade", count: 6, timing: "mainTurn" },
    { id: "masterMerchant", label: "Master Merchant", category: "trade", count: 2, timing: "mainTurn" },
    { id: "engineer", label: "Engineer", category: "science", count: 1, timing: "mainTurn" },
    { id: "medicine", label: "Medicine", category: "science", count: 2, timing: "mainTurn" },
    { id: "crane", label: "Crane", category: "science", count: 2, timing: "mainTurn" },
  ],
  progressHandLimit: 4,
  metropolis: { claimLevel: 4, takeLevel: 5, victoryPoints: 2 },
  wall: { cost: { brick: 2 }, perPlayer: 3, discardBonus: 2 },
  merchantVictoryPoints: 1,
};

export function createCitiesAndKnightsRuleSet(
  options: BaseRuleSetOptions = {}
): { ruleSet: RuleSet; state: RngState } {
  const { ruleSet: base, state } = createBaseRuleSet(options);
  return {
    ruleSet: {
      ...base,
      id: CITIES_AND_KNIGHTS_ID,
      victoryPoints: 13,
      citiesAndKnights: { ...CITIES_AND_KNIGHTS_RULES },
    },
    state,
  };
}
