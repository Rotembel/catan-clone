// Cities & Knights slice 4: metropolises, city walls, the merchant, and the
// progress cards they unlock. Each area pins the base game stays untouched.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { resolveBarbarianAttack, cityVertices } from "../src/reducers/barbarians.js";
import { discardCountFor, discardThresholdFor } from "../src/reducers/dice.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { metropolisClaim, metropolisEligibleCities } from "../src/reducers/metropolis.js";
import { playableProgressCards } from "../src/reducers/progress.js";
import { totalCards } from "../src/resources.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { tradeRatiosFor } from "../src/selectors/production.js";
import { totalVictoryPoints } from "../src/selectors/victory.js";
import { normalizeState } from "../src/state.js";
import { giveCommodities, giveProgressCards, giveResources, inMainTurn, newGame, ringOf, testRuleSet, withBuilding, withImprovement, withKnight, withWall } from "./fixtures.js";
import type { GameState, RuleSet } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true, uniformNumberToken: 6 });
const base = testRuleSet({ uniformNumberToken: 6 });
const A = ringOf(ck.board.hexes[3]!.id).vertices;
const B = ringOf(ck.board.hexes[9]!.id).vertices;

function bare(ruleSet: RuleSet, players = ["A", "B", "C"]): GameState {
  const g = newGame(ruleSet, players);
  return inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
}
const improve = (s: GameState, playerId: number, track: "trade" | "politics" | "science") =>
  apply(s, { playerId, action: { type: "buildImprovement", track } }, ck);

describe("metropolises", () => {
  it("level 4 claims an unowned metropolis onto your only city, automatically, worth 2 VP", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "city");
    s = withImprovement(s, 0, "trade", 3);
    s = giveCommodities(s, 0, { cloth: 4 });
    expect(metropolisClaim(s, ck, 0, "trade")).toBeUndefined();
    const l4 = improve(s, 0, "trade");
    expect(l4.metropolises.trade).toEqual({ playerId: 0, vertex: A[0] });
    expect(l4.turn.phase).toBe("mainTurn");
    expect(totalVictoryPoints(l4, ck, 0)).toBe(2 + 2);
    expect(l4.players[0]!.victoryPoints).toBe(4); // public VP includes it
  });

  it("with several eligible cities you choose; the phase blocks everything else; one per track", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), A[2]!, 0, "city");
    s = withImprovement(s, 0, "science", 3);
    s = giveCommodities(s, 0, { paper: 4 });
    const paused = improve(s, 0, "science");
    expect(paused.turn.phase).toBe("metropolisPlacement");
    expect(paused.pendingMetropolis).toEqual({ playerId: 0, track: "science" });
    expect(() => apply(paused, { playerId: 0, action: { type: "endTurn" } }, ck)).toThrow(IllegalActionError);
    expect(legalActions(paused, ck, 0).map((a) => a.type)).toEqual(["placeMetropolis", "placeMetropolis"]);
    expect(legalActions(paused, ck, 1)).toEqual([]);
    expect(() => apply(paused, { playerId: 1, action: { type: "placeMetropolis", vertex: A[0]! } }, ck)).toThrow(/no metropolis to place/);

    const placed = apply(paused, { playerId: 0, action: { type: "placeMetropolis", vertex: A[2]! } }, ck);
    expect(placed.metropolises.science).toEqual({ playerId: 0, vertex: A[2] });
    expect(placed.turn.phase).toBe("mainTurn");
    // A second track's metropolis can't share that city.
    const s2 = giveCommodities(withImprovement(placed, 0, "trade", 3), 0, { cloth: 4 });
    const both = improve(s2, 0, "trade");
    expect(both.metropolises.trade).toEqual({ playerId: 0, vertex: A[0] }); // the other city, automatically
    expect(metropolisEligibleCities(both, 0)).toEqual([]);
  });

  it("ties: first to level 4 keeps it; level 5 takes it from a holder at 4; a holder at 5 is safe", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), B[0]!, 1, "city");
    s = giveCommodities(withImprovement(s, 0, "politics", 3), 0, { coin: 10 });
    s = giveCommodities(withImprovement(s, 1, "politics", 3), 1, { coin: 10 });
    s = improve(s, 0, "politics"); // player 0 at 4: holder
    s = { ...s, turn: { current: 1, phase: "mainTurn" } };
    s = improve(s, 1, "politics"); // player 1 also at 4: nothing moves
    expect(s.metropolises.politics).toEqual({ playerId: 0, vertex: A[0] });
    expect(metropolisClaim(s, ck, 1, "politics")).toBeUndefined();
    s = improve(s, 1, "politics"); // player 1 at 5 vs holder at 4: takes it
    expect(s.metropolises.politics).toEqual({ playerId: 1, vertex: B[0] });
    expect(totalVictoryPoints(s, ck, 0)).toBe(2);
    expect(totalVictoryPoints(s, ck, 1)).toBe(4);
    s = { ...s, turn: { current: 0, phase: "mainTurn" } };
    s = improve(s, 0, "politics"); // player 0 reaches 5 too: holder at 5 keeps it
    expect(s.metropolises.politics).toEqual({ playerId: 1, vertex: B[0] });
    expect(s.players.map((p) => p.improvements.politics)).toEqual([5, 5, 0]);
  });

  it("an open claim with no city lands when you next build one", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "settlement");
    s = giveCommodities(withImprovement(s, 0, "trade", 3), 0, { cloth: 4 });
    // improvements need a city, so grant the level directly
    s = withImprovement(s, 0, "trade", 4);
    expect(s.metropolises.trade).toBeUndefined();
    s = giveResources(s, 0, { wheat: 2, ore: 3 });
    const built = apply(s, { playerId: 0, action: { type: "buildCity", vertex: A[0]! } }, ck);
    expect(built.metropolises.trade).toEqual({ playerId: 0, vertex: A[0] });
  });

  it("is immune to the barbarians; a player whose only city is a metropolis is not at risk", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), B[0]!, 1, "city");
    s = { ...s, metropolises: { trade: { playerId: 0, vertex: A[0]! } } };
    expect(cityVertices(s, 0)).toEqual([]);
    const lost = resolveBarbarianAttack(s); // nobody has knights: barbarians win
    expect(lost.board.buildings[A[0]!]?.kind).toBe("city");
    expect(lost.board.buildings[B[0]!]?.kind).toBe("settlement");
    expect(lost.metropolises.trade).toEqual({ playerId: 0, vertex: A[0] });
  });

  it("does not exist in the base game", () => {
    const s = withImprovement(withBuilding(bare(base), A[0]!, 0, "city"), 0, "trade", 5);
    expect(metropolisClaim(s, base, 0, "trade")).toBeUndefined();
    expect(() => apply(s, { playerId: 0, action: { type: "placeMetropolis", vertex: A[0]! } }, base)).toThrow(/not part of this rule set/);
  });
});

describe("city walls", () => {
  it("cost 2 brick, one per city (not settlements), at most 3, and count toward nothing else", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), A[2]!, 0, "settlement");
    expect(legalActions(s, ck, 0).some((a) => a.type === "buildWall")).toBe(false);
    s = giveResources(s, 0, { brick: 2 });
    const walls = legalActions(s, ck, 0).filter((a) => a.type === "buildWall") as { vertex: string }[];
    expect(walls.map((w) => w.vertex)).toEqual([A[0]]);
    const built = apply(s, { playerId: 0, action: { type: "buildWall", vertex: A[0]! } }, ck);
    expect(built.board.walls[A[0]!]).toBe(0);
    expect(built.players[0]!.resources.brick).toBe(0);
    expect(built.bank.brick).toBe(21);
    expect(() => apply(giveResources(built, 0, { brick: 2 }), { playerId: 0, action: { type: "buildWall", vertex: A[0]! } }, ck)).toThrow(/without a wall/);
    expect(() => apply(giveResources(built, 0, { brick: 2 }), { playerId: 0, action: { type: "buildWall", vertex: A[2]! } }, ck)).toThrow(/without a wall/);
    expect(totalVictoryPoints(built, ck, 0)).toBe(3); // no VP for walls

    let three = built;
    for (const v of [A[4]!, B[0]!, B[2]!]) three = withBuilding(three, v, 0, "city");
    three = withWall(withWall(three, A[4]!, 0), B[0]!, 0);
    three = giveResources(three, 0, { brick: 2 });
    expect(() => apply(three, { playerId: 0, action: { type: "buildWall", vertex: B[2]! } }, ck)).toThrow(/no walls left/);
  });

  it("each wall raises the robber's discard threshold by 2", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "city");
    s = giveResources(s, 0, { wood: 9 }); // 9 cards
    expect(discardThresholdFor(s, ck, 0)).toBe(7);
    expect(discardCountFor(s, 0, ck)).toBe(4);
    s = withWall(s, A[0]!, 0);
    expect(discardThresholdFor(s, ck, 0)).toBe(9);
    expect(discardCountFor(s, 0, ck)).toBe(0);
    // Through the real roll: a 7 with 9 cards and one wall owes nothing.
    let seven = { ...s, turn: { current: 0, phase: "rollDice" as const } };
    let rolled: GameState | undefined;
    for (let i = 0; i < 300 && !rolled; i++) {
      const n = apply(seven, { playerId: 0, action: { type: "rollDice" } }, ck);
      if (n.dice && n.dice[0] + n.dice[1] === 7 && n.eventDie !== "barbarian") rolled = n;
      else seven = { ...seven, rngState: n.rngState };
    }
    expect(rolled).toBeDefined();
    expect(rolled!.turn.phase).toBe("moveRobberAfterSeven");
    expect(rolled!.pendingDiscards).toBeUndefined();
    expect(discardThresholdFor(s, base, 0)).toBe(7); // base game: walls don't exist
  });

  it("is lost with the city when the barbarians downgrade it", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), B[0]!, 1, "city");
    s = withWall(s, A[0]!, 0);
    s = withKnight(s, B[2]!, 1, { active: true }); // player 1 defended, player 0 at 0 loses
    const after = resolveBarbarianAttack(s);
    expect(after.board.buildings[A[0]!]?.kind).toBe("settlement");
    expect(after.board.walls[A[0]!]).toBeUndefined();
    expect(after.board.buildings[B[0]!]?.kind).toBe("city");
  });
});

describe("the merchant", () => {
  it("is placed by the card on a land hex next to your building, gives 2:1 on that resource and 1 VP; another player's card moves it", () => {
    const hex = ck.board.hexes[3]!;
    let s = withBuilding(bare(ck), A[0]!, 0, "settlement");
    s = giveProgressCards(s, 0, ["merchant"]);
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads as { hex: string }[];
    expect(opts.map((o) => o.hex)).toContain(hex.id);
    expect(opts.every((o) => ck.board.hexes.find((h) => h.id === o.hex)!.resource !== "desert")).toBe(true);
    const placed = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "merchant", payload: { hex: hex.id } } }, ck);
    expect(placed.merchant).toEqual({ hex: hex.id, playerId: 0 });
    expect(tradeRatiosFor(placed, ck, 0)[hex.resource as "wood"]).toBe(2);
    expect(tradeRatiosFor(placed, ck, 1)[hex.resource as "wood"]).toBe(4);
    expect(totalVictoryPoints(placed, ck, 0)).toBe(2);

    // Player 1 takes it over.
    const farHex = ck.board.hexes[9]!;
    let p1 = withBuilding(placed, B[0]!, 1, "settlement");
    p1 = giveProgressCards(p1, 1, ["merchant"]);
    p1 = { ...p1, turn: { current: 1, phase: "mainTurn" } };
    const moved = apply(p1, { playerId: 1, action: { type: "playProgressCard", cardId: "merchant", payload: { hex: farHex.id } } }, ck);
    expect(moved.merchant).toEqual({ hex: farHex.id, playerId: 1 });
    expect(totalVictoryPoints(moved, ck, 0)).toBe(1);
    expect(totalVictoryPoints(moved, ck, 1)).toBe(2);
    expect(() => apply(p1, { playerId: 1, action: { type: "playProgressCard", cardId: "merchant", payload: { hex: hex.id } } }, ck)).toThrow(/next to one of your buildings/);
  });
});

describe("cards unlocked by slice 4", () => {
  it("Engineer walls a city for free, within the wall limit", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "city");
    s = giveProgressCards(s, 0, ["engineer"]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "engineer", payload: { vertex: A[0]! } } }, ck);
    expect(after.board.walls[A[0]!]).toBe(0);
    expect(after.players[0]!.resources).toEqual(s.players[0]!.resources);
    expect(playableProgressCards(giveProgressCards(after, 0, ["engineer"]), ck, 0)).toEqual([]); // no unwalled city left
  });

  it("Medicine upgrades a settlement for 2 ore + 1 wheat", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "settlement");
    s = giveProgressCards(s, 0, ["medicine"]);
    expect(playableProgressCards(s, ck, 0)).toEqual([]); // can't afford
    s = giveResources(s, 0, { ore: 2, wheat: 1 });
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "medicine", payload: { vertex: A[0]! } } }, ck);
    expect(after.board.buildings[A[0]!]?.kind).toBe("city");
    expect(after.players[0]!.resources.ore).toBe(0);
    expect(after.players[0]!.resources.wheat).toBe(0);
    expect(after.bank.ore).toBe(21);
  });

  it("Crane buys an improvement for one commodity less and can trigger a metropolis", () => {
    let s = withBuilding(bare(ck), A[0]!, 0, "city");
    s = withImprovement(s, 0, "science", 3);
    s = giveCommodities(s, 0, { paper: 3 }); // level 4 costs 4; with the crane, 3
    s = giveProgressCards(s, 0, ["crane"]);
    expect(legalActions(s, ck, 0).some((a) => a.type === "buildImprovement")).toBe(false);
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads;
    // Level 4 science for 3 paper — and, for one less, level 1 trade/politics for nothing at all.
    expect(opts).toEqual([{ track: "trade" }, { track: "politics" }, { track: "science" }]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "crane", payload: { track: "science" } } }, ck);
    expect(after.players[0]!.improvements.science).toBe(4);
    expect(after.players[0]!.commodities.paper).toBe(0);
    expect(after.metropolises.science).toEqual({ playerId: 0, vertex: A[0] });
  });

  it("Master Merchant takes up to 2 cards from a player with more points", () => {
    let s = withBuilding(bare(ck), B[0]!, 1, "city"); // player 1: 2 VP, player 0: 0
    s = giveResources(s, 1, { ore: 3 });
    s = giveCommodities(s, 1, { cloth: 1 });
    s = giveProgressCards(s, 0, ["masterMerchant"]);
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads;
    expect(opts).toEqual([{ playerId: 1, cards: { ore: 2 } }, { playerId: 1, cards: { cloth: 1 } }]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "masterMerchant", payload: { playerId: 1, cards: { ore: 1, cloth: 1 } } } }, ck);
    expect(after.players[0]!.resources.ore).toBe(1);
    expect(after.players[0]!.commodities.cloth).toBe(1);
    expect(after.players[1]!.resources.ore).toBe(2);
    // Not from a poorer player.
    let poor = giveProgressCards(withBuilding(bare(ck), A[0]!, 0, "city"), 0, ["masterMerchant"]);
    poor = giveResources(poor, 1, { ore: 2 });
    expect(playableProgressCards(poor, ck, 0)).toEqual([]);
    expect(() => apply(poor, { playerId: 0, action: { type: "playProgressCard", cardId: "masterMerchant", payload: { playerId: 1, cards: { ore: 1 } } } }, ck)).toThrow(/more points/);
  });
});

describe("persistence", () => {
  it("metropolises, walls, the merchant and a pending placement survive a JSON round trip", () => {
    let s = withBuilding(withBuilding(bare(ck), A[0]!, 0, "city"), A[2]!, 0, "city");
    s = withWall(s, A[0]!, 0);
    s = { ...s, merchant: { hex: ck.board.hexes[3]!.id, playerId: 0 }, metropolises: { trade: { playerId: 0, vertex: A[0]! } }, pendingMetropolis: { playerId: 0, track: "science" }, turn: { current: 0, phase: "metropolisPlacement" } };
    const back = normalizeState(JSON.parse(JSON.stringify(s)) as GameState);
    expect(back).toEqual(s);
    expect(totalVictoryPoints(back, ck, 0)).toBe(totalVictoryPoints(s, ck, 0));
    expect(legalActions(back, ck, 0).map((a) => (a as { vertex: string }).vertex)).toEqual([A[2]]);
  });

  it("older saves get empty walls and metropolises", () => {
    const old = JSON.parse(JSON.stringify(newGame(base))) as Record<string, unknown>;
    delete old.metropolises;
    delete (old.board as Record<string, unknown>).walls;
    const fixed = normalizeState(old as unknown as GameState);
    expect(fixed.metropolises).toEqual({});
    expect(fixed.board.walls).toEqual({});
    expect(totalCards(fixed.bank)).toBe(95);
  });
});
