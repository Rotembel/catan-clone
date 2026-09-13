// Enumerates what a player may legally do right now. Used by the CLI
// harness and its bots, and by tests that want to drive a whole game
// without hand-writing every move.
//
// Two action spaces are too large to enumerate honestly, and are handled
// specially: discards (every subset of a hand) return one valid canonical
// choice, and player-to-player trade proposals (unbounded) are not
// enumerated at all.

import type { Action, Card, CardCounts, GameState, RuleSet } from "@catan/shared";
import { discardCountFor } from "../reducers/dice.js";
import { pieceCounts, pieceLimitsOf } from "../reducers/helpers.js";
import { canBuildImprovement } from "../reducers/improve.js";
import { cityVertices } from "../reducers/barbarians.js";
import { knightCounts, knightReachableVertices, legalKnightVertices } from "../reducers/knights.js";
import { playableProgressCards } from "../reducers/progress.js";
import { metropolisEligibleCities } from "../reducers/metropolis.js";
import { canBuildWall, legalWallVertices } from "../reducers/walls.js";
import { stealTargetsAt } from "../reducers/robber.js";
import { CARDS, COMMODITIES, IMPROVEMENT_TRACKS, RESOURCES, canAfford, isCommodity } from "../resources.js";
import {
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  legalSetupRoadEdges,
} from "./building.js";
import { commodityTradeRatioFor, tradeRatiosFor } from "./production.js";

/** A deterministic, legal discard: shed from the biggest stacks first. */
export function canonicalDiscard(state: GameState, playerId: number, ruleSet?: RuleSet): CardCounts {
  const player = state.players.find((p) => p.id === playerId);
  const discard: CardCounts = {};
  if (!player) return discard;

  let remaining = discardCountFor(state, playerId, ruleSet);
  const pool: { resource: Card; count: number }[] = [
    ...RESOURCES.map((r) => ({ resource: r as Card, count: player.resources[r] })),
    ...COMMODITIES.map((c) => ({ resource: c as Card, count: player.commodities[c] })),
  ]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.resource.localeCompare(b.resource));

  while (remaining > 0) {
    let progressed = false;
    for (const entry of pool) {
      if (remaining === 0) break;
      const already = discard[entry.resource] ?? 0;
      if (already >= entry.count) continue;
      discard[entry.resource] = already + 1;
      remaining--;
      progressed = true;
    }
    if (!progressed) break;
  }
  return discard;
}

function robberActions(state: GameState, ruleSet: RuleSet, playerId: number): Action[] {
  const actions: Action[] = [];
  for (const hex of ruleSet.board.hexes) {
    if (hex.id === state.board.robberHex) continue;
    const victims = stealTargetsAt(state, ruleSet, hex.id, playerId);
    if (victims.length === 0) {
      actions.push({ type: "moveRobber", hex: hex.id });
    } else {
      for (const victim of victims) {
        actions.push({ type: "moveRobber", hex: hex.id, stealFrom: victim });
      }
    }
  }
  return actions;
}

function knightActions(state: GameState, ruleSet: RuleSet, playerId: number): Action[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.hasPlayedDevCardThisTurn) return [];
  const playable =
    player.devCards.filter((id) => id === "knight").length -
    player.devCardsBoughtThisTurn.filter((id) => id === "knight").length;
  if (playable <= 0) return [];

  return robberActions(state, ruleSet, playerId).map((a) => {
    const move = a as Extract<Action, { type: "moveRobber" }>;
    return {
      type: "playDevCard",
      cardId: "knight",
      payload: { hex: move.hex, stealFrom: move.stealFrom },
    } satisfies Action;
  });
}

export function legalActions(state: GameState, ruleSet: RuleSet, playerId: number): Action[] {
  if (state.winner !== undefined || state.turn.phase === "gameOver") return [];

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return [];
  const isCurrent = state.players[state.turn.current]?.id === playerId;
  const actions: Action[] = [];

  // Anyone offered a trade may answer it, on or off their turn.
  if (state.pendingTrade?.toPlayerId === playerId) {
    actions.push({ type: "respondTrade", accept: true });
    actions.push({ type: "respondTrade", accept: false });
  }

  switch (state.turn.phase) {
    case "setupSettlement1":
    case "setupSettlement2": {
      if (!isCurrent) break;
      for (const vertex of legalSettlementVertices(state, ruleSet, playerId, {
        requireRoadConnection: false,
      })) {
        actions.push({ type: "buildSettlement", vertex });
      }
      break;
    }

    case "setupRoad1":
    case "setupRoad2": {
      if (!isCurrent || state.setupLastSettlement === undefined) break;
      for (const edge of legalSetupRoadEdges(state, ruleSet, state.setupLastSettlement)) {
        actions.push({ type: "buildRoad", edge });
      }
      break;
    }

    case "rollDice": {
      if (!isCurrent) break;
      actions.push({ type: "rollDice" });
      actions.push(...knightActions(state, ruleSet, playerId));
      for (const { cardId, payloads } of playableProgressCards(state, ruleSet, playerId)) {
        for (const payload of payloads) actions.push({ type: "playProgressCard", cardId, payload });
      }
      break;
    }

    case "discard": {
      if (!(state.pendingDiscards ?? []).includes(playerId)) break;
      actions.push({ type: "discardCards", discard: canonicalDiscard(state, playerId, ruleSet) });
      break;
    }

    case "moveRobberAfterSeven": {
      if (!isCurrent) break;
      actions.push(...robberActions(state, ruleSet, playerId));
      break;
    }

    case "barbarianDowngrade": {
      if (!(state.pendingDowngrades ?? []).includes(playerId)) break;
      for (const vertex of cityVertices(state, playerId)) actions.push({ type: "downgradeCity", vertex });
      break;
    }

    case "progressDiscard": {
      if (!(state.pendingProgressDiscards ?? []).includes(playerId)) break;
      for (const cardId of [...new Set(player.progressCards)]) actions.push({ type: "discardProgressCard", cardId });
      break;
    }

    case "metropolisPlacement": {
      if (state.pendingMetropolis?.playerId !== playerId) break;
      for (const vertex of metropolisEligibleCities(state, playerId)) actions.push({ type: "placeMetropolis", vertex });
      break;
    }

    case "mainTurn": {
      if (!isCurrent) break;
      actions.push({ type: "endTurn" });

      const counts = pieceCounts(state, playerId);
      const limits = pieceLimitsOf(ruleSet);

      if (canAfford(player.resources, ruleSet.costs.road) && counts.roads < limits.roads) {
        for (const edge of legalRoadEdges(state, ruleSet, playerId)) {
          actions.push({ type: "buildRoad", edge });
        }
      }
      if (
        canAfford(player.resources, ruleSet.costs.settlement) &&
        counts.settlements < limits.settlements
      ) {
        for (const vertex of legalSettlementVertices(state, ruleSet, playerId, {
          requireRoadConnection: true,
        })) {
          actions.push({ type: "buildSettlement", vertex });
        }
      }
      if (canAfford(player.resources, ruleSet.costs.city) && counts.cities < limits.cities) {
        for (const vertex of legalCityVertices(state, playerId)) {
          actions.push({ type: "buildCity", vertex });
        }
      }
      if (canAfford(player.resources, ruleSet.costs.devCard) && state.devDeck.length > 0) {
        actions.push({ type: "buyDevCard" });
      }

      for (const track of IMPROVEMENT_TRACKS) {
        if (canBuildImprovement(state, ruleSet, playerId, track)) {
          actions.push({ type: "buildImprovement", track });
        }
      }

      const ck = ruleSet.citiesAndKnights;
      if (ck) {
        if (canBuildWall(state, ruleSet, playerId)) {
          for (const vertex of legalWallVertices(state, playerId)) actions.push({ type: "buildWall", vertex });
        }
        const knights = knightCounts(state, playerId);
        if (canAfford(player.resources, ck.knightCosts.build) && knights[1] < ck.knightsPerLevel) {
          for (const vertex of legalKnightVertices(state, ruleSet, playerId)) {
            actions.push({ type: "buildKnight", vertex });
          }
        }
        for (const [vertex, knight] of Object.entries(state.board.knights)) {
          if (!knight || knight.playerId !== playerId) continue;
          if (!knight.active && canAfford(player.resources, ck.knightCosts.activate)) {
            actions.push({ type: "activateKnight", vertex });
          }
          if (knight.level < 3 && canAfford(player.resources, ck.knightCosts.promote)) {
            const level = (knight.level + 1) as 2 | 3;
            const fortressOk = level < 3 || player.improvements.politics >= ck.fortressLevel;
            if (fortressOk && knights[level] < ck.knightsPerLevel) {
              actions.push({ type: "promoteKnight", vertex });
            }
          }
          if (knight.active && !knight.activatedThisTurn) {
            for (const to of knightReachableVertices(state, ruleSet, playerId, vertex)) {
              actions.push({ type: "moveKnight", from: vertex, to });
            }
          }
        }
      }

      actions.push(...knightActions(state, ruleSet, playerId));

      for (const { cardId, payloads } of playableProgressCards(state, ruleSet, playerId)) {
        for (const payload of payloads) actions.push({ type: "playProgressCard", cardId, payload });
      }

      if (!player.hasPlayedDevCardThisTurn) {
        const playable = (cardId: string) =>
          player.devCards.filter((id) => id === cardId).length -
          player.devCardsBoughtThisTurn.filter((id) => id === cardId).length;

        if (playable("roadBuilding") > 0) {
          const edges = legalRoadEdges(state, ruleSet, playerId);
          const room = limits.roads - counts.roads;
          if (edges.length >= 2 && room >= 2) {
            actions.push({
              type: "playDevCard",
              cardId: "roadBuilding",
              payload: { edges: [edges[0]!, edges[1]!] },
            });
          } else if (edges.length >= 1 && room >= 1) {
            actions.push({
              type: "playDevCard",
              cardId: "roadBuilding",
              payload: { edges: [edges[0]!] },
            });
          }
        }

        if (playable("yearOfPlenty") > 0) {
          for (const a of RESOURCES) {
            for (const b of RESOURCES) {
              const needed = a === b ? 2 : 1;
              if (state.bank[a] < needed || state.bank[b] < needed) continue;
              actions.push({
                type: "playDevCard",
                cardId: "yearOfPlenty",
                payload: { resources: [a, b] },
              });
            }
          }
        }

        if (playable("monopoly") > 0) {
          for (const resource of RESOURCES) {
            actions.push({ type: "playDevCard", cardId: "monopoly", payload: { resource } });
          }
        }
      }

      // Bank/port trades: one ratio's worth of any card for any other.
      const ratios = tradeRatiosFor(state, ruleSet, playerId);
      const tradable: Card[] = ruleSet.citiesAndKnights ? [...CARDS] : [...RESOURCES];
      const held = (c: Card) => (isCommodity(c) ? player.commodities[c] : player.resources[c]);
      const inBank = (c: Card) => (isCommodity(c) ? state.commodityBank[c] : state.bank[c]);
      for (const give of tradable) {
        const ratio = isCommodity(give) ? commodityTradeRatioFor(state, ruleSet, playerId, give) : ratios[give];
        if (held(give) < ratio) continue;
        for (const receive of tradable) {
          if (receive === give || inBank(receive) < 1) continue;
          actions.push({
            type: "proposeTrade",
            offer: {
              fromPlayerId: playerId,
              give: { [give]: ratio },
              receive: { [receive]: 1 },
            },
          });
        }
      }
      break;
    }
  }

  return actions;
}

/** True when this player currently has something they must or may do. */
export function hasLegalActions(state: GameState, ruleSet: RuleSet, playerId: number): boolean {
  return legalActions(state, ruleSet, playerId).length > 0;
}
