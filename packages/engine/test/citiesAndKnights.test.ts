// Cities & Knights slice 1: commodities and city improvements. Every
// behaviour here is keyed off ruleSet.citiesAndKnights, so each test also
// pins down that the base rule set is untouched.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { getGeometry } from "../src/geometryCache.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { applyRobberMove, stealTargetsAt } from "../src/reducers/robber.js";
import { discardCountFor } from "../src/reducers/dice.js";
import { handSize } from "../src/resources.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { commodityTradeRatioFor, productionForRoll } from "../src/selectors/production.js";
import { totalVictoryPoints } from "../src/selectors/victory.js";
import {
  giveCommodities,
  giveResources,
  inMainTurn,
  newGame,
  playSetup,
  testRuleSet,
  withBuilding,
  withImprovement,
} from "./fixtures.js";
import type { GameState, Resource, RuleSet, VertexId } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true, uniformNumberToken: 6 });
const base = testRuleSet({ uniformNumberToken: 6 });

/**
 * A vertex on a hex of the given resource — a coastal one touching only
 * that hex when the fixture board has one, otherwise any. Tests that need
 * exact totals use `hexesOf` to know what else the vertex touches.
 */
function vertexOn(ruleSet: RuleSet, resource: Resource): VertexId {
  const geometry = getGeometry(ruleSet.board);
  let fallback: VertexId | undefined;
  for (const hex of ruleSet.board.hexes) {
    if (hex.resource !== resource) continue;
    for (const [vertex, hexIds] of geometry.vertexHexes) {
      if (!hexIds.includes(hex.id)) continue;
      if (hexIds.length === 1) return vertex;
      fallback ??= vertex;
    }
  }
  if (!fallback) throw new Error(`no vertex on a ${resource} hex`);
  return fallback;
}
const loneVertexOn = vertexOn;

/** How many hexes of each resource a vertex touches. */
function hexesOf(ruleSet: RuleSet, vertex: VertexId): Partial<Record<Resource, number>> {
  const geometry = getGeometry(ruleSet.board);
  const out: Partial<Record<Resource, number>> = {};
  for (const hexId of geometry.vertexHexes.get(vertex) ?? []) {
    const hex = ruleSet.board.hexes.find((h) => h.id === hexId);
    if (!hex || hex.resource === "desert") continue;
    out[hex.resource] = (out[hex.resource] ?? 0) + 1;
  }
  return out;
}

/** A game with nothing on the board, sitting in player 0's main turn. */
function bare(ruleSet: RuleSet): GameState {
  const g = newGame(ruleSet);
  return inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
}

describe("commodity production", () => {
  it("a city on a pasture yields 1 sheep + 1 cloth; on a field, 2 wheat; a settlement never yields a commodity", () => {
    let state = bare(ck);
    state = withBuilding(state, loneVertexOn(ck, "sheep"), 0, "city");
    state = withBuilding(state, loneVertexOn(ck, "wheat"), 0, "city");
    const oreSpot = vertexOn(ck, "ore");
    state = withBuilding(state, oreSpot, 1, "settlement");

    const { gains, commodityGains, commodityBank } = productionForRoll(state, ck, 6);
    expect(gains.get(0)).toEqual({ sheep: 1, wheat: 2 });
    expect(commodityGains.get(0)).toEqual({ cloth: 1 });
    // The settlement gets 1 per touching hex and never a commodity.
    expect(gains.get(1)).toEqual(hexesOf(ck, oreSpot));
    expect(gains.get(1)!.ore).toBe(hexesOf(ck, oreSpot).ore);
    expect(commodityGains.get(1)).toBeUndefined();
    expect(commodityBank.cloth).toBe(11);
  });

  it("in the base game the same city yields 2 sheep and no commodity", () => {
    let state = bare(base);
    state = withBuilding(state, loneVertexOn(base, "sheep"), 0, "city");
    const { gains, commodityGains, commodityBank } = productionForRoll(state, base, 6);
    expect(gains.get(0)).toEqual({ sheep: 2 });
    expect(commodityGains.size).toBe(0);
    expect(commodityBank).toEqual({ cloth: 0, coin: 0, paper: 0 });
  });

  it("the commodity bank follows the shortage rule independently of resources", () => {
    let state = bare(ck);
    state = { ...state, commodityBank: { ...state.commodityBank, cloth: 1 } };
    state = withBuilding(state, loneVertexOn(ck, "sheep"), 0, "city");
    // A second city on another pasture, owned by player 1.
    const geometry = getGeometry(ck.board);
    const first = loneVertexOn(ck, "sheep");
    const other = [...geometry.vertexHexes.entries()].find(([v, hexIds]) => {
      if (v === first || hexIds.length !== 1) return false;
      const hex = ck.board.hexes.find((h) => h.id === hexIds[0]);
      return hex?.resource === "sheep" && hex.id !== geometry.vertexHexes.get(first)![0];
    })![0];
    state = withBuilding(state, other, 1, "city");

    const { gains, commodityGains } = productionForRoll(state, ck, 6);
    // Both still get their sheep; nobody gets cloth (1 in bank, 2 owed).
    expect(gains.get(0)?.sheep).toBe(1);
    expect(gains.get(1)?.sheep).toBe(1);
    expect(commodityGains.get(0)).toBeUndefined();
    expect(commodityGains.get(1)).toBeUndefined();
  });

  it("the roll reducer credits commodities and debits the commodity bank", () => {
    let state = bare(ck);
    const spot = vertexOn(ck, "ore");
    const oreHexes = hexesOf(ck, spot).ore ?? 0;
    state = withBuilding(state, spot, 0, "city");
    state = { ...state, turn: { current: 0, phase: "rollDice" } };
    // Find a seed-independent path: force the dice by rolling until a 6 appears.
    let rolled: GameState | undefined;
    let s = state;
    for (let i = 0; i < 200 && !rolled; i++) {
      const next = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
      if (next.dice && next.dice[0] + next.dice[1] === 6) rolled = next;
      else s = { ...state, rngState: next.rngState };
    }
    expect(rolled).toBeDefined();
    expect(oreHexes).toBeGreaterThan(0);
    expect(rolled!.players[0]!.commodities.coin).toBe(oreHexes);
    expect(rolled!.players[0]!.resources.ore).toBe(oreHexes);
    expect(rolled!.commodityBank.coin).toBe(12 - oreHexes);
  });
});

describe("city improvements", () => {
  it("costs the track's commodity per level, needs a city, and returns cards to the bank", () => {
    let state = bare(ck);
    state = withBuilding(state, loneVertexOn(ck, "sheep"), 0, "city");
    state = giveCommodities(state, 0, { cloth: 3 });

    expect(legalActions(state, ck, 0)).toContainEqual({ type: "buildImprovement", track: "trade" });
    expect(legalActions(state, ck, 0)).not.toContainEqual({ type: "buildImprovement", track: "politics" });

    const l1 = apply(state, { playerId: 0, action: { type: "buildImprovement", track: "trade" } }, ck);
    expect(l1.players[0]!.improvements.trade).toBe(1);
    expect(l1.players[0]!.commodities.cloth).toBe(2);
    expect(l1.commodityBank.cloth).toBe(13);

    const l2 = apply(l1, { playerId: 0, action: { type: "buildImprovement", track: "trade" } }, ck);
    expect(l2.players[0]!.improvements.trade).toBe(2);
    expect(l2.players[0]!.commodities.cloth).toBe(0);

    // Level 3 costs 3 cloth; none left.
    expect(() =>
      apply(l2, { playerId: 0, action: { type: "buildImprovement", track: "trade" } }, ck)
    ).toThrow(IllegalActionError);
  });

  it("is refused without a city, at the maximum level, and in the base game", () => {
    let noCity = bare(ck);
    noCity = withBuilding(noCity, loneVertexOn(ck, "sheep"), 0, "settlement");
    noCity = giveCommodities(noCity, 0, { cloth: 5 });
    expect(() =>
      apply(noCity, { playerId: 0, action: { type: "buildImprovement", track: "trade" } }, ck)
    ).toThrow(/need a city/);

    let maxed = withBuilding(bare(ck), loneVertexOn(ck, "sheep"), 0, "city");
    maxed = giveCommodities(maxed, 0, { paper: 9 });
    maxed = withImprovement(maxed, 0, "science", 5);
    expect(() =>
      apply(maxed, { playerId: 0, action: { type: "buildImprovement", track: "science" } }, ck)
    ).toThrow(/maximum/);

    let inBase = withBuilding(bare(base), loneVertexOn(base, "sheep"), 0, "city");
    inBase = giveCommodities(inBase, 0, { cloth: 5 });
    expect(() =>
      apply(inBase, { playerId: 0, action: { type: "buildImprovement", track: "trade" } }, base)
    ).toThrow(/not part of this rule set/);
    expect(legalActions(inBase, base, 0).some((a) => a.type === "buildImprovement")).toBe(false);
  });
});

describe("commodities in hands", () => {
  it("count toward the 7-card limit and can be discarded", () => {
    let state = bare(ck);
    state = giveResources(state, 0, { wood: 5 });
    state = giveCommodities(state, 0, { cloth: 3, paper: 1 });
    expect(handSize(state.players[0]!)).toBe(9);
    expect(discardCountFor(state, 0)).toBe(4);

    state = { ...state, turn: { current: 1, phase: "discard" }, pendingDiscards: [0] };
    const after = apply(
      state,
      { playerId: 0, action: { type: "discardCards", discard: { cloth: 2, wood: 2 } } },
      ck
    );
    expect(after.players[0]!.commodities.cloth).toBe(1);
    expect(after.players[0]!.resources.wood).toBe(3);
    expect(after.commodityBank.cloth).toBe(14);
    expect(after.bank.wood).toBe(21);
    expect(after.turn.phase).toBe("moveRobberAfterSeven");
  });

  it("can be stolen by the robber", () => {
    let state = bare(ck);
    const spot = loneVertexOn(ck, "sheep");
    state = withBuilding(state, spot, 1, "settlement");
    state = giveCommodities(state, 1, { coin: 2 }); // no resources at all
    const hex = getGeometry(ck.board).vertexHexes.get(spot)![0]!;

    expect(stealTargetsAt(state, ck, hex, 0)).toEqual([1]);
    const after = applyRobberMove(state, ck, 0, hex, 1);
    expect(after.players[0]!.commodities.coin).toBe(1);
    expect(after.players[1]!.commodities.coin).toBe(1);
  });
});

describe("trading commodities", () => {
  it("4:1 with the bank by default, 2:1 once the trading house is built; never in the base game", () => {
    let state = bare(ck);
    state = giveCommodities(state, 0, { cloth: 6 });
    expect(commodityTradeRatioFor(state, ck, 0)).toBe(4);

    const four = apply(
      state,
      { playerId: 0, action: { type: "proposeTrade", offer: { fromPlayerId: 0, give: { cloth: 4 }, receive: { wood: 1 } } } },
      ck
    );
    expect(four.players[0]!.commodities.cloth).toBe(2);
    expect(four.players[0]!.resources.wood).toBe(1);
    expect(four.commodityBank.cloth).toBe(16);
    expect(four.bank.wood).toBe(18);

    const house = withImprovement(four, 0, "trade", 3);
    expect(commodityTradeRatioFor(house, ck, 0)).toBe(2);
    const two = apply(
      house,
      { playerId: 0, action: { type: "proposeTrade", offer: { fromPlayerId: 0, give: { cloth: 2 }, receive: { coin: 1 } } } },
      ck
    );
    expect(two.players[0]!.commodities).toEqual({ cloth: 0, coin: 1, paper: 0 });

    // The bot-facing enumeration agrees.
    expect(
      legalActions(house, ck, 0).some(
        (a) => a.type === "proposeTrade" && a.offer.toPlayerId === undefined && a.offer.give.cloth === 2
      )
    ).toBe(true);

    let inBase = bare(base);
    inBase = giveCommodities(inBase, 0, { cloth: 4 });
    expect(() =>
      apply(
        inBase,
        { playerId: 0, action: { type: "proposeTrade", offer: { fromPlayerId: 0, give: { cloth: 4 }, receive: { wood: 1 } } } },
        base
      )
    ).toThrow(/no commodities/);
  });

  it("player to player: commodities move like any other card", () => {
    let state = bare(ck);
    state = giveCommodities(state, 0, { paper: 1 });
    state = giveResources(state, 1, { brick: 1 });
    const offer = { fromPlayerId: 0, toPlayerId: 1, give: { paper: 1 }, receive: { brick: 1 } };
    const proposed = apply(state, { playerId: 0, action: { type: "proposeTrade", offer } }, ck);
    const accepted = apply(proposed, { playerId: 1, action: { type: "respondTrade", accept: true } }, ck);
    expect(accepted.players[0]!.commodities.paper).toBe(0);
    expect(accepted.players[0]!.resources.brick).toBe(1);
    expect(accepted.players[1]!.commodities.paper).toBe(1);
    expect(accepted.players[1]!.resources.brick).toBe(0);
  });
});

describe("opening placement", () => {
  it("with Cities & Knights the second placement is a city worth 2, paying resources only", () => {
    const state = playSetup(newGame(ck), ck);
    for (const p of state.players) {
      const mine = Object.values(state.board.buildings).filter((b) => b?.playerId === p.id);
      expect(mine.map((b) => b!.kind).sort()).toEqual(["city", "settlement"]);
      expect(totalVictoryPoints(state, ck, p.id)).toBe(3);
      expect(p.commodities).toEqual({ cloth: 0, coin: 0, paper: 0 });
    }
    expect(state.commodityBank).toEqual({ cloth: 12, coin: 12, paper: 12 });
  });

  it("the base game still places two settlements", () => {
    const state = playSetup(newGame(base), base);
    for (const p of state.players) {
      const mine = Object.values(state.board.buildings).filter((b) => b?.playerId === p.id);
      expect(mine.map((b) => b!.kind)).toEqual(["settlement", "settlement"]);
      expect(totalVictoryPoints(state, base, p.id)).toBe(2);
    }
    expect(state.commodityBank).toEqual({ cloth: 0, coin: 0, paper: 0 });
  });
});
