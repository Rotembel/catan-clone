// Buying and playing development cards. Deck composition and effects are
// keyed by the RuleSet's card ids, not hardcoded counts.

import type {
  GameState,
  KnightPayload,
  MonopolyPayload,
  Resource,
  RoadBuildingPayload,
  RuleSet,
  YearOfPlentyPayload,
} from "@catan/shared";
import { addResources, canAfford, subtractResources } from "../resources.js";
import { placeFreeRoad } from "./build.js";
import {
  illegal,
  refresh,
  requireCurrentPlayer,
  requirePhase,
  updatePlayer,
} from "./helpers.js";
import { applyRobberMove } from "./robber.js";

export function buyDevCard(state: GameState, ruleSet: RuleSet, playerId: number): GameState {
  requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  if (state.devDeck.length === 0) illegal("the development card deck is empty");

  const cost = ruleSet.costs.devCard;
  const player = state.players.find((p) => p.id === playerId)!;
  if (!canAfford(player.resources, cost)) illegal(`player ${playerId} cannot afford a development card`);

  const [card, ...rest] = state.devDeck;
  let next: GameState = { ...state, devDeck: rest, bank: addResources(state.bank, cost) };
  next = updatePlayer(next, playerId, (p) => ({
    ...p,
    resources: subtractResources(p.resources, cost),
    devCards: [...p.devCards, card!],
    devCardsBoughtThisTurn: [...p.devCardsBoughtThisTurn, card!],
  }));

  // Buying a victory-point card can win the game outright.
  return refresh(next, ruleSet, playerId);
}

/** Cards of this id the player may play right now (bought-this-turn cards can't be). */
function playableCount(state: GameState, playerId: number, cardId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  const inHand = player.devCards.filter((id) => id === cardId).length;
  const boughtThisTurn = player.devCardsBoughtThisTurn.filter((id) => id === cardId).length;
  return inHand - boughtThisTurn;
}

function removeCard(cards: string[], cardId: string): string[] {
  const index = cards.indexOf(cardId);
  if (index < 0) return cards;
  return [...cards.slice(0, index), ...cards.slice(index + 1)];
}

export function playDevCard(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  cardId: string,
  payload: unknown
): GameState {
  // A knight may be played before rolling, which is the whole point of
  // pre-emptively moving the robber off your own hex.
  const isKnight = ruleSet.devCards.find((d) => d.id === cardId)?.kind === "knight";
  if (isKnight) requirePhase(state, "rollDice", "mainTurn");
  else requirePhase(state, "mainTurn");
  requireCurrentPlayer(state, playerId);

  const def = ruleSet.devCards.find((d) => d.id === cardId);
  if (!def) illegal(`no such development card: ${cardId}`);
  if (def.kind === "victoryPoint") illegal("victory point cards are not played, they just count");

  const player = state.players.find((p) => p.id === playerId)!;
  if (player.hasPlayedDevCardThisTurn) illegal("only one development card may be played per turn");
  if (playableCount(state, playerId, cardId) <= 0) {
    illegal(`player ${playerId} has no playable ${cardId} (cards bought this turn must wait)`);
  }

  let next = updatePlayer(state, playerId, (p) => ({
    ...p,
    devCards: removeCard(p.devCards, cardId),
    hasPlayedDevCardThisTurn: true,
  }));

  switch (cardId) {
    case "knight": {
      const { hex, stealFrom } = (payload ?? {}) as KnightPayload;
      if (!hex) illegal("knight needs a hex to move the robber to");
      next = updatePlayer(next, playerId, (p) => ({ ...p, playedKnights: p.playedKnights + 1 }));
      next = applyRobberMove(next, ruleSet, playerId, hex, stealFrom);
      break;
    }

    case "roadBuilding": {
      const { edges } = (payload ?? {}) as RoadBuildingPayload;
      if (!Array.isArray(edges) || edges.length === 0 || edges.length > 2) {
        illegal("road building needs 1 or 2 edges");
      }
      for (const edge of edges) {
        next = placeFreeRoad(next, ruleSet, playerId, edge);
      }
      break;
    }

    case "yearOfPlenty": {
      const { resources } = (payload ?? {}) as YearOfPlentyPayload;
      if (!Array.isArray(resources) || resources.length !== 2) {
        illegal("year of plenty needs exactly 2 resources");
      }
      const take: Partial<Record<Resource, number>> = {};
      for (const r of resources) take[r] = (take[r] ?? 0) + 1;
      for (const [r, amount] of Object.entries(take) as [Resource, number][]) {
        if (next.bank[r] < amount) illegal(`the bank has no ${r} left`);
      }
      next = { ...next, bank: subtractResources(next.bank, take) };
      next = updatePlayer(next, playerId, (p) => ({ ...p, resources: addResources(p.resources, take) }));
      break;
    }

    case "monopoly": {
      const { resource } = (payload ?? {}) as MonopolyPayload;
      if (!resource) illegal("monopoly needs a resource");
      let taken = 0;
      next = {
        ...next,
        players: next.players.map((p) => {
          if (p.id === playerId) return p;
          const amount = p.resources[resource];
          if (amount <= 0) return p;
          taken += amount;
          return { ...p, resources: subtractResources(p.resources, { [resource]: amount }) };
        }),
      };
      next = updatePlayer(next, playerId, (p) => ({
        ...p,
        resources: addResources(p.resources, { [resource]: taken }),
      }));
      break;
    }

    default:
      illegal(`don't know how to play ${cardId}`);
  }

  return refresh(next, ruleSet, playerId);
}
