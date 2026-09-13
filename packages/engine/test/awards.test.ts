// Longest Road, Largest Army, and victory detection — the three rules most
// likely to be subtly wrong, so they get built boards rather than played ones.

import { describe, expect, it } from "vitest";
import type { GameState } from "@catan/shared";
import { longestRoadLength, resolveLargestArmy, resolveLongestRoad } from "../src/selectors/awards.js";
import { publicVictoryPoints, totalVictoryPoints, hasWon } from "../src/selectors/victory.js";
import { apply } from "../src/apply.js";
import { refresh } from "../src/reducers/helpers.js";
import { getGeometry } from "../src/geometryCache.js";
import {
  giveDevCard,
  giveResources,
  inMainTurn,
  newGame,
  playSetup,
  ringOf,
  testRuleSet,
  withBuilding,
  withRoads,
} from "./fixtures.js";

const ruleSet = testRuleSet();

/** A clean board: setup done, then every piece wiped so tests can place their own. */
function emptyBoard(): GameState {
  const state = inMainTurn(playSetup(newGame(ruleSet), ruleSet));
  return {
    ...state,
    board: { ...state.board, buildings: {}, roads: {} },
    longestRoadPlayerId: undefined,
    largestArmyPlayerId: undefined,
  };
}

describe("longest road", () => {
  const centerRing = ringOf(ruleSet.board.hexes.find((h) => h.q === 0 && h.r === 0)!.id);

  it("counts a connected chain", () => {
    const state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 4));
    expect(longestRoadLength(state, ruleSet, 0)).toBe(4);
  });

  it("counts a closed loop as its full length", () => {
    const state = withRoads(emptyBoard(), 0, centerRing.edges);
    expect(longestRoadLength(state, ruleSet, 0)).toBe(6);
  });

  it("ignores another player's roads", () => {
    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 2));
    state = withRoads(state, 1, centerRing.edges.slice(2, 5));
    expect(longestRoadLength(state, ruleSet, 0)).toBe(2);
    expect(longestRoadLength(state, ruleSet, 1)).toBe(3);
  });

  it("is broken by an opponent's settlement in the middle", () => {
    // edges[0..2] run through vertices 0-1-2-3; an enemy building on vertex 2
    // means the chain can't be counted through it.
    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 3));
    expect(longestRoadLength(state, ruleSet, 0)).toBe(3);

    state = withBuilding(state, centerRing.vertices[2]!, 1);
    expect(longestRoadLength(state, ruleSet, 0)).toBe(2);
  });

  it("is not broken by the road owner's own settlement", () => {
    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 3));
    state = withBuilding(state, centerRing.vertices[2]!, 0);
    expect(longestRoadLength(state, ruleSet, 0)).toBe(3);
  });

  it("awards the card at 5 and not before", () => {
    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 4));
    expect(resolveLongestRoad(state, ruleSet)).toBeUndefined();

    state = withRoads(state, 0, centerRing.edges.slice(0, 5));
    expect(resolveLongestRoad(state, ruleSet)).toBe(0);
  });

  it("stays with the holder on a tie, and moves only when strictly beaten", () => {
    const otherHex = ruleSet.board.hexes.find((h) => h.q === 2 && h.r === 0)!;
    const otherRing = ringOf(otherHex.id);

    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 5));
    state = { ...state, longestRoadPlayerId: resolveLongestRoad(state, ruleSet) };
    expect(state.longestRoadPlayerId).toBe(0);

    // Player 1 ties at 5 — the holder keeps it.
    state = withRoads(state, 1, otherRing.edges.slice(0, 5));
    expect(resolveLongestRoad(state, ruleSet)).toBe(0);

    // Player 1 goes to 6 — now it moves.
    state = withRoads(state, 1, otherRing.edges);
    expect(resolveLongestRoad(state, ruleSet)).toBe(1);
  });

  it("is worth 2 victory points to its holder", () => {
    let state = withRoads(emptyBoard(), 0, centerRing.edges.slice(0, 5));
    state = refresh(state, ruleSet);
    expect(state.longestRoadPlayerId).toBe(0);
    expect(publicVictoryPoints(state, 0)).toBe(2);
  });
});

describe("largest army", () => {
  it("needs 3 knights, and only moves when strictly beaten", () => {
    const base = emptyBoard();
    const withKnights = (counts: number[]) => ({
      ...base,
      players: base.players.map((p, i) => ({ ...p, playedKnights: counts[i] ?? 0 })),
    });

    expect(resolveLargestArmy(withKnights([2, 0]))).toBeUndefined();
    expect(resolveLargestArmy(withKnights([3, 0]))).toBe(0);

    const holder = { ...withKnights([3, 3]), largestArmyPlayerId: 0 };
    expect(resolveLargestArmy(holder)).toBe(0); // tie keeps the holder

    const beaten = { ...withKnights([3, 4]), largestArmyPlayerId: 0 };
    expect(resolveLargestArmy(beaten)).toBe(1);
  });

  it("is earned by actually playing knights, and is worth 2 points", () => {
    let state = emptyBoard();
    const hexes = ruleSet.board.hexes.filter((h) => h.id !== state.board.robberHex);
    for (let i = 0; i < 3; i++) state = giveDevCard(state, 0, "knight");

    for (let i = 0; i < 3; i++) {
      state = apply(
        state,
        { playerId: 0, action: { type: "playDevCard", cardId: "knight", payload: { hex: hexes[i]!.id } } },
        ruleSet
      );
      // Reset the once-per-turn flag rather than playing three full turns.
      state = {
        ...state,
        players: state.players.map((p) => ({ ...p, hasPlayedDevCardThisTurn: false })),
        turn: { current: 0, phase: "mainTurn" },
      };
    }

    expect(state.players[0]!.playedKnights).toBe(3);
    expect(state.largestArmyPlayerId).toBe(0);
    expect(publicVictoryPoints(state, 0)).toBe(2);
  });
});

describe("victory", () => {
  it("counts buildings, awards, and hidden VP cards", () => {
    const centerRing = ringOf(ruleSet.board.hexes.find((h) => h.q === 0 && h.r === 0)!.id);
    let state = emptyBoard();
    state = withBuilding(state, centerRing.vertices[0]!, 0, "city"); // 2
    state = withBuilding(state, centerRing.vertices[2]!, 0, "settlement"); // 1
    state = withRoads(state, 0, centerRing.edges.slice(0, 5)); // longest road: 2
    state = refresh(state, ruleSet);

    expect(publicVictoryPoints(state, 0)).toBe(5);

    state = giveDevCard(state, 0, "victoryPoint");
    expect(publicVictoryPoints(state, 0)).toBe(5);
    expect(totalVictoryPoints(state, ruleSet, 0)).toBe(6);
  });

  it("declares a winner the moment the target is reached", () => {
    const shortGame = testRuleSet({ victoryPoints: 3 });
    const ring = ringOf(shortGame.board.hexes.find((h) => h.q === 0 && h.r === 0)!.id);

    let state = inMainTurn(playSetup(newGame(shortGame), shortGame));
    state = { ...state, board: { ...state.board, buildings: {}, roads: {} } };
    state = withBuilding(state, ring.vertices[0]!, 0, "city"); // 2 points
    // Roads out to vertex 2 — vertex 1 is adjacent to the city, so the
    // distance rule puts the nearest legal spot two steps around the ring.
    state = withRoads(state, 0, [ring.edges[0]!, ring.edges[1]!]);
    state = giveResources(state, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });

    expect(hasWon(state, shortGame, 0)).toBe(false);

    // A third point via a settlement ends it.
    const after = apply(
      state,
      { playerId: 0, action: { type: "buildSettlement", vertex: ring.vertices[2]! } },
      shortGame
    );
    expect(after.winner).toBe(0);
    expect(after.turn.phase).toBe("gameOver");
  });

  it("refuses any further action once the game is over", () => {
    const shortGame = testRuleSet({ victoryPoints: 1 });
    const ring = ringOf(shortGame.board.hexes.find((h) => h.q === 0 && h.r === 0)!.id);
    let state = inMainTurn(playSetup(newGame(shortGame), shortGame));
    state = { ...state, winner: 0, turn: { current: 0, phase: "gameOver" } };

    expect(() => apply(state, { playerId: 0, action: { type: "endTurn" } }, shortGame)).toThrow();
    expect(getGeometry(shortGame.board).hexes.size).toBe(19);
    expect(ring.vertices).toHaveLength(6);
  });
});
