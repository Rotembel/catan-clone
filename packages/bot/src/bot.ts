// A deliberately simple bot — good enough to drive a full game to victory,
// and no smarter. Shared by the CLI harness and the server's live bot
// seats (docs/planning/HOME_LAN_VERSION_WRAP.md §6-7).
//
// It never constructs actions itself: it picks from `legalActions`, so the
// engine stays the only authority on what's legal. Its own randomness is a
// separate RNG state from the game's, so games stay reproducible, and it
// is a pure function of (state, ruleSet, playerId, rng) — no clock, no I/O.

import {
  RESOURCES,
  getGeometry,
  legalActions,
  nextInt,
  pieceCounts,
  pieceLimitsOf,
  tradeRatiosFor,
  totalCards,
  type RngState,
} from "@catan/engine";
import type { Action, GameState, Resource, RuleSet, VertexId } from "@catan/shared";

/** Dice-probability weight of a number token (6 and 8 are the good ones). */
const PIPS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

/** How good a spot is: total pips, plus a nudge toward varied resources. */
function vertexValue(state: GameState, ruleSet: RuleSet, vertex: VertexId): number {
  const geometry = getGeometry(ruleSet.board);
  const hexIds = geometry.vertexHexes.get(vertex) ?? [];
  let pips = 0;
  const resources = new Set<string>();
  for (const hexId of hexIds) {
    const hex = ruleSet.board.hexes.find((h) => h.id === hexId);
    const token = state.board.tokenOverrides[hex?.id ?? ""] ?? hex?.numberToken ?? null;
    if (!hex || token === null || hex.resource === "desert") continue;
    pips += PIPS[token] ?? 0;
    resources.add(hex.resource);
  }
  const portBonus = ruleSet.board.ports.some((p) => p.vertexIds.includes(vertex)) ? 1 : 0;
  return pips + resources.size + portBonus;
}

function bestBy<T>(items: T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

function ofType<K extends Action["type"]>(actions: Action[], type: K): Extract<Action, { type: K }>[] {
  return actions.filter((a): a is Extract<Action, { type: K }> => a.type === type);
}

/** How many cards short the player is of a given cost. */
function deficit(
  state: GameState,
  playerId: number,
  cost: Partial<Record<Resource, number>>
): Partial<Record<Resource, number>> {
  const player = state.players.find((p) => p.id === playerId)!;
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const missing = (cost[r] ?? 0) - player.resources[r];
    if (missing > 0) out[r] = missing;
  }
  return out;
}

/** What the bot is saving up for, in priority order. */
function currentGoal(state: GameState, ruleSet: RuleSet, playerId: number): Partial<Record<Resource, number>> {
  const counts = pieceCounts(state, playerId);
  const limits = pieceLimitsOf(ruleSet);
  if (counts.settlements > 0 && counts.cities < limits.cities) return ruleSet.costs.city;
  if (counts.settlements < limits.settlements) return ruleSet.costs.settlement;
  return ruleSet.costs.devCard;
}

function robberScore(state: GameState, ruleSet: RuleSet, playerId: number, action: Extract<Action, { type: "moveRobber" }>): number {
  const geometry = getGeometry(ruleSet.board);
  const cube = geometry.hexes.get(action.hex);
  if (!cube) return -Infinity;

  let score = 0;
  for (const [vertex, hexIds] of geometry.vertexHexes) {
    if (!hexIds.includes(action.hex)) continue;
    const building = state.board.buildings[vertex];
    if (!building) continue;
    // Hurting opponents is good; sitting on your own production is not.
    score += building.playerId === playerId ? -5 : 2;
  }
  if (action.stealFrom !== undefined) {
    const victim = state.players.find((p) => p.id === action.stealFrom);
    if (victim) score += Math.min(totalCards(victim.resources), 5);
  }
  return score;
}

/** Is the robber currently sitting on one of my hexes? */
function robberHurtsMe(state: GameState, ruleSet: RuleSet, playerId: number): boolean {
  const geometry = getGeometry(ruleSet.board);
  for (const [vertex, hexIds] of geometry.vertexHexes) {
    if (!hexIds.includes(state.board.robberHex)) continue;
    if (state.board.buildings[vertex]?.playerId === playerId) return true;
  }
  return false;
}

export interface BotChoice {
  action: Action | undefined;
  rng: RngState;
}

export function chooseAction(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  rng: RngState
): BotChoice {
  const options = legalActions(state, ruleSet, playerId);
  if (options.length === 0) return { action: undefined, rng };

  // Discards and trade responses first — they're forced or nearly so.
  const discards = ofType(options, "discardCards");
  if (discards.length > 0) return { action: discards[0], rng };

  // Cities & Knights: a lost barbarian attack — give up the lowest-value city.
  const downgrades = ofType(options, "downgradeCity");
  if (downgrades.length > 0) {
    return { action: bestBy(downgrades, (a) => -vertexValue(state, ruleSet, a.vertex)), rng };
  }

  // Cities & Knights: over the progress hand limit — drop the first card.
  const progressDiscards = ofType(options, "discardProgressCard");
  if (progressDiscards.length > 0) return { action: progressDiscards[0], rng };

  const responses = ofType(options, "respondTrade");
  if (responses.length > 0) {
    return { action: responses.find((r) => !r.accept) ?? responses[0], rng };
  }

  // Setup and main-phase settlements: always take the best spot available.
  const settlements = ofType(options, "buildSettlement");
  if (settlements.length > 0 && state.turn.phase.startsWith("setup")) {
    return { action: bestBy(settlements, (a) => vertexValue(state, ruleSet, a.vertex)), rng };
  }

  const setupRoads = ofType(options, "buildRoad");
  if (state.turn.phase.startsWith("setup") && setupRoads.length > 0) {
    const geometry = getGeometry(ruleSet.board);
    return {
      action: bestBy(setupRoads, (a) => {
        const ends = geometry.edgeVertices.get(a.edge) ?? [];
        return Math.max(...ends.map((v) => vertexValue(state, ruleSet, v)));
      }),
      rng,
    };
  }

  const robberMoves = ofType(options, "moveRobber");
  if (robberMoves.length > 0) {
    return { action: bestBy(robberMoves, (a) => robberScore(state, ruleSet, playerId, a)), rng };
  }

  if (state.turn.phase === "rollDice") {
    // Clear the robber off my own hexes before rolling, if I can.
    const knights = options.filter((a) => a.type === "playDevCard" && a.cardId === "knight");
    if (knights.length > 0 && robberHurtsMe(state, ruleSet, playerId)) {
      return {
        action: bestBy(knights, (a) => {
          const payload = (a as { payload: { hex: string; stealFrom?: number } }).payload;
          return robberScore(state, ruleSet, playerId, {
            type: "moveRobber",
            hex: payload.hex,
            stealFrom: payload.stealFrom,
          });
        }),
        rng,
      };
    }
    return { action: options.find((a) => a.type === "rollDice"), rng };
  }

  // --- main turn, in priority order ---

  // Cities & Knights: improvements are the only use for commodities.
  const improvements = ofType(options, "buildImprovement");
  if (improvements.length > 0) return { action: improvements[0], rng };

  // Cities & Knights progress cards: only the ones with a safe, obvious
  // payoff. Everything else stays in hand (see HANDOFF.md).
  const progress = ofType(options, "playProgressCard");
  const safeCard = (id: string) => progress.filter((a) => a.cardId === id);
  const harvest = [...safeCard("irrigation"), ...safeCard("mining")];
  if (harvest.length > 0) return { action: harvest[0], rng };
  const warlords = safeCard("warlord");
  if (warlords.length > 0) return { action: warlords[0], rng };
  const monopolies = safeCard("resourceMonopoly");
  if (monopolies.length > 0) {
    const best = bestBy(monopolies, (a) => {
      const r = (a.payload as { resource: Resource }).resource;
      return state.players.filter((p) => p.id !== playerId).reduce((s, p) => s + Math.min(2, p.resources[r]), 0);
    })!;
    const haul = state.players.filter((p) => p.id !== playerId).reduce((s, p) => s + Math.min(2, p.resources[(best.payload as { resource: Resource }).resource]), 0);
    if (haul >= 2) return { action: best, rng };
  }
  const freeRoads = safeCard("roadBuilding");
  if (freeRoads.length > 0) return { action: freeRoads[0], rng };

  // Cities & Knights, minimal defence: keep one knight, and keep it active.
  // (No promotion or movement strategy yet — see HANDOFF.md.)
  const activations = ofType(options, "activateKnight");
  if (activations.length > 0) return { action: activations[0], rng };
  const knightBuilds = ofType(options, "buildKnight");
  if (knightBuilds.length > 0 && Object.values(state.board.knights).filter((k) => k?.playerId === playerId).length === 0) {
    return { action: bestBy(knightBuilds, (a) => vertexValue(state, ruleSet, a.vertex)), rng };
  }

  const cities = ofType(options, "buildCity");
  if (cities.length > 0) {
    return { action: bestBy(cities, (a) => vertexValue(state, ruleSet, a.vertex)), rng };
  }

  if (settlements.length > 0) {
    return { action: bestBy(settlements, (a) => vertexValue(state, ruleSet, a.vertex)), rng };
  }

  const player = state.players.find((p) => p.id === playerId)!;
  const counts = pieceCounts(state, playerId);

  // Monopoly / year of plenty are pure upside when held.
  const monopoly = options.filter((a) => a.type === "playDevCard" && a.cardId === "monopoly");
  if (monopoly.length > 0) {
    const totals = new Map<Resource, number>();
    for (const other of state.players) {
      if (other.id === playerId) continue;
      for (const r of RESOURCES) totals.set(r, (totals.get(r) ?? 0) + other.resources[r]);
    }
    const best = bestBy(monopoly, (a) => {
      const resource = (a as { payload: { resource: Resource } }).payload.resource;
      return totals.get(resource) ?? 0;
    });
    const haul = totals.get((best as { payload: { resource: Resource } }).payload.resource) ?? 0;
    if (haul >= 3) return { action: best, rng };
  }

  const yearOfPlenty = options.filter((a) => a.type === "playDevCard" && a.cardId === "yearOfPlenty");
  if (yearOfPlenty.length > 0) {
    const want = deficit(state, playerId, currentGoal(state, ruleSet, playerId));
    const wanted = Object.keys(want) as Resource[];
    if (wanted.length > 0) {
      const best = bestBy(yearOfPlenty, (a) => {
        const picks = (a as { payload: { resources: Resource[] } }).payload.resources;
        return picks.filter((r) => wanted.includes(r)).length;
      });
      return { action: best, rng };
    }
  }

  // Roads: only when they'd open somewhere to build, or chase longest road.
  const roads = ofType(options, "buildRoad");
  const settlementSpots = legalActions(state, ruleSet, playerId).filter((a) => a.type === "buildSettlement");
  if (roads.length > 0 && settlementSpots.length === 0 && counts.roads < pieceLimitsOf(ruleSet).roads) {
    const geometry = getGeometry(ruleSet.board);
    return {
      action: bestBy(roads, (a) => {
        const ends = geometry.edgeVertices.get(a.edge) ?? [];
        return Math.max(...ends.map((v) => vertexValue(state, ruleSet, v)));
      }),
      rng,
    };
  }

  const buy = options.find((a) => a.type === "buyDevCard");
  if (buy && totalCards(player.resources) >= 5) return { action: buy, rng };

  // Trade toward whatever we're short of.
  const want = deficit(state, playerId, currentGoal(state, ruleSet, playerId));
  const wanted = Object.keys(want) as Resource[];
  if (wanted.length > 0) {
    const goal = currentGoal(state, ruleSet, playerId);
    const ratios = tradeRatiosFor(state, ruleSet, playerId);
    const trades = ofType(options, "proposeTrade").filter((a) => {
      const give = Object.keys(a.offer.give)[0] as Resource | undefined;
      const receive = Object.keys(a.offer.receive)[0] as Resource | undefined;
      if (!give || !receive) return false;
      if (!wanted.includes(receive)) return false;
      // Don't trade away cards the goal itself needs.
      const spare = player.resources[give] - (goal[give] ?? 0);
      return spare >= ratios[give];
    });
    if (trades.length > 0) {
      const { value, state: nextRng } = nextInt(rng, trades.length);
      return { action: trades[value], rng: nextRng };
    }
  }

  return { action: options.find((a) => a.type === "endTurn") ?? options[0], rng };
}
