// Cities & Knights slice 3: progress cards — decks, event-die distribution,
// the hand limit, play legality, and every implemented card. Each area also
// pins that the base game is untouched.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { getGeometry } from "../src/geometryCache.js";
import { createProgressDecks, drawProgressCard } from "../src/progress/deck.js";
import { distributeProgressCards, eligibleForProgressCard, progressDrawOrder } from "../src/progress/draw.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { playableProgressCards } from "../src/reducers/progress.js";
import { createRng, rollTwoDice } from "../src/rng.js";
import { totalCards } from "../src/resources.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { commodityTradeRatioFor, productionForRoll, tradeRatiosFor } from "../src/selectors/production.js";
import { totalVictoryPoints } from "../src/selectors/victory.js";
import { normalizeState } from "../src/state.js";
import {
  giveCommodities,
  giveProgressCards,
  giveResources,
  inMainTurn,
  newGame,
  ringOf,
  testRuleSet,
  withBuilding,
  withImprovement,
  withKnight,
  withRoads,
} from "./fixtures.js";
import type { GameState, RuleSet } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true, uniformNumberToken: 6 });
const base = testRuleSet({ uniformNumberToken: 6 });
const totalDefined = (rs: RuleSet, track: "trade" | "politics" | "science") =>
  rs.citiesAndKnights!.progressCards.filter((d) => d.category === track).reduce((s, d) => s + d.count, 0);

function bare(ruleSet: RuleSet, players = ["A", "B", "C"]): GameState {
  const g = newGame(ruleSet, players);
  return inMainTurn({ ...g, board: { ...g.board, buildings: {}, roads: {} } });
}

describe("progress decks", () => {
  it("are built and shuffled deterministically from the rule set, per category", () => {
    const a = createProgressDecks(ck, createRng("deck"));
    const b = createProgressDecks(ck, createRng("deck"));
    expect(a).toEqual(b);
    for (const t of ["trade", "politics", "science"] as const) {
      expect(a.decks[t].draw).toHaveLength(totalDefined(ck, t));
      expect(a.decks[t].discard).toEqual([]);
    }
    expect(a.decks.trade.draw).not.toEqual(createProgressDecks(ck, createRng("other")).decks.trade.draw);
    expect(a.state).not.toBe(createRng("deck")); // RNG advanced
  });

  it("stay empty and consume no RNG in the base game", () => {
    const rng = createRng("base");
    const { decks, state } = createProgressDecks(base, rng);
    expect(decks).toEqual({ trade: { draw: [], discard: [] }, politics: { draw: [], discard: [] }, science: { draw: [], discard: [] } });
    expect(state).toBe(rng);
    expect(newGame(base).progressDecks.trade.draw).toEqual([]);
  });

  it("draw from the top; an empty pile reshuffles its discards; both empty gives nothing", () => {
    const g = newGame(ck);
    const top = g.progressDecks.science.draw[0]!;
    const drawn = drawProgressCard(g, "science");
    expect(drawn.card).toBe(top);
    expect(drawn.state.progressDecks.science.draw).toHaveLength(g.progressDecks.science.draw.length - 1);

    const empty: GameState = { ...g, progressDecks: { ...g.progressDecks, trade: { draw: [], discard: ["merchantFleet", "tradeMonopoly", "resourceMonopoly"] } } };
    const refilled = drawProgressCard(empty, "trade");
    expect(refilled.card).toBeDefined();
    expect(refilled.state.progressDecks.trade.draw.length + 1).toBe(3);
    expect(refilled.state.progressDecks.trade.discard).toEqual([]);
    expect(refilled.state.rngState).not.toBe(empty.rngState);

    const dry: GameState = { ...g, progressDecks: { ...g.progressDecks, trade: { draw: [], discard: [] } } };
    expect(drawProgressCard(dry, "trade").card).toBeUndefined();
  });
});

describe("event-die eligibility and distribution", () => {
  it("level >= 1 and red <= level + 1", () => {
    expect(eligibleForProgressCard(0, 1)).toBe(false);
    expect(eligibleForProgressCard(1, 2)).toBe(true);
    expect(eligibleForProgressCard(1, 3)).toBe(false);
    expect(eligibleForProgressCard(3, 4)).toBe(true);
    expect(eligibleForProgressCard(3, 5)).toBe(false);
    expect(eligibleForProgressCard(5, 6)).toBe(true);
  });

  it("deals to eligible players in seat order starting with the roller, one card each", () => {
    let s = bare(ck);
    s = { ...s, dice: [2, 4], turn: { current: 1, phase: "rollDice" } };
    s = withImprovement(s, 0, "trade", 1); // eligible for red 2
    s = withImprovement(s, 1, "trade", 0); // not eligible
    s = withImprovement(s, 2, "trade", 3); // eligible
    expect(progressDrawOrder(s, ck, "trade")).toEqual([2, 0]); // roller (1) is skipped; 2 then wraps to 0
    const before = s.progressDecks.trade.draw.length;
    const after = distributeProgressCards(s, ck, "trade");
    expect(after.players[0]!.progressCards).toHaveLength(1);
    expect(after.players[1]!.progressCards).toHaveLength(0);
    expect(after.players[2]!.progressCards).toHaveLength(1);
    expect(after.progressDecks.trade.draw).toHaveLength(before - 2);
    expect(after.turn.phase).toBe("rollDice"); // nobody over the limit: the caller resolves the roll
  });

  it("resolves victory-point cards immediately and never puts them in a hand", () => {
    let s = bare(ck);
    s = { ...s, dice: [1, 1], progressDecks: { ...s.progressDecks, politics: { draw: ["constitution", "bishop"], discard: [] } } };
    s = withImprovement(s, 0, "politics", 1);
    const after = distributeProgressCards(s, ck, "politics");
    expect(after.players[0]!.progressVictoryPoints).toBe(1);
    expect(after.players[0]!.progressCards).toEqual([]);
    expect(after.progressDecks.politics.discard).toEqual(["constitution"]);
    expect(totalVictoryPoints(after, ck, 0)).toBe(1);
  });

  it("over the hand limit: pauses in progressDiscard until the player chooses, then the roll resolves", () => {
    let s = bare(ck);
    s = withBuilding(s, ringOf(ck.board.hexes[3]!.id).vertices[0]!, 0, "settlement");
    s = giveProgressCards(s, 0, ["bishop", "warlord", "spy", "mining"]); // at the limit of 4
    s = { ...s, dice: [3, 3], turn: { current: 0, phase: "rollDice" }, progressDecks: { ...s.progressDecks, science: { draw: ["inventor"], discard: [] } } };
    s = withImprovement(s, 0, "science", 5);
    const paused = distributeProgressCards(s, ck, "science");
    expect(paused.turn.phase).toBe("progressDiscard");
    expect(paused.pendingProgressDiscards).toEqual([0]);
    expect(paused.players[0]!.progressCards).toHaveLength(5);

    // Nothing else may happen; player 1 owes nothing; the choice is enumerated.
    expect(() => apply(paused, { playerId: 0, action: { type: "endTurn" } }, ck)).toThrow(IllegalActionError);
    expect(() => apply(paused, { playerId: 1, action: { type: "discardProgressCard", cardId: "bishop" } }, ck)).toThrow(/does not owe/);
    const choices = legalActions(paused, ck, 0).filter((a) => a.type === "discardProgressCard");
    expect(choices.map((a) => (a as { cardId: string }).cardId).sort()).toEqual(["bishop", "inventor", "mining", "spy", "warlord"]);
    expect(legalActions(paused, ck, 1)).toEqual([]);

    const resumed = apply(paused, { playerId: 0, action: { type: "discardProgressCard", cardId: "spy" } }, ck);
    expect(resumed.players[0]!.progressCards).toHaveLength(4);
    expect(resumed.progressDecks.politics.discard).toContain("spy");
    expect(resumed.pendingProgressDiscards).toBeUndefined();
    expect(resumed.turn.phase).toBe("mainTurn"); // the 6 was produced
    expect(totalCards(resumed.players[0]!.resources)).toBeGreaterThan(0);
  });

  it("flows through rollDice: gates deal cards, barbarians still sail, production still pays; base game unaffected", () => {
    let s = bare(ck);
    s = withBuilding(s, ringOf(ck.board.hexes[3]!.id).vertices[0]!, 0, "settlement");
    for (const t of ["trade", "politics", "science"] as const) s = withImprovement(s, 0, t, 5); // always eligible
    s = { ...s, turn: { current: 0, phase: "rollDice" } };
    let gates = 0, ships = 0, produced = 0;
    for (let i = 0; i < 40; i++) {
      const next = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
      if (next.eventDie === "barbarian") ships++;
      else gates++;
      if (next.turn.phase === "mainTurn" && totalCards(next.players[0]!.resources) > totalCards(s.players[0]!.resources)) produced++;
      const hand = next.players[0]!.progressCards.length + next.players[0]!.progressVictoryPoints;
      const face = next.eventDie!;
      const supply = face === "barbarian" ? 0 : s.progressDecks[face].draw.length + s.progressDecks[face].discard.length;
      if (face !== "barbarian" && supply > 0 && next.turn.phase !== "progressDiscard") expect(hand).toBeGreaterThanOrEqual(1);
      // keep rolling from a clean roll phase, carrying the rng and decks
      s = { ...s, rngState: next.rngState, progressDecks: next.progressDecks, barbarianPosition: next.barbarianPosition };
    }
    expect(gates).toBeGreaterThan(0);
    expect(ships).toBeGreaterThan(0);
    expect(produced).toBeGreaterThan(0);

    const b = { ...bare(base), turn: { current: 0, phase: "rollDice" as const } };
    const rolled = apply(b, { playerId: 0, action: { type: "rollDice" } }, base);
    expect(rolled.players.every((p) => p.progressCards.length === 0)).toBe(true);
    expect(rolled.dice).toEqual(rollTwoDice(b.rngState).dice); // exactly the two dice, nothing more
  });
});

describe("play legality", () => {
  it("needs the card in hand, the right phase, your own turn, and the expansion", () => {
    let s = bare(ck);
    expect(() => apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "warlord" } }, ck)).toThrow(/do not hold/);
    s = giveProgressCards(s, 0, ["alchemist", "resourceMonopoly"]);
    expect(() => apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "alchemist", payload: { dice: [6, 6] } } }, ck)).toThrow(IllegalActionError); // not before the roll
    expect(() => apply(s, { playerId: 1, action: { type: "playProgressCard", cardId: "resourceMonopoly", payload: { resource: "ore" } } }, ck)).toThrow(IllegalActionError);
    expect(() => apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "constitution" } }, ck)).toThrow(/never played|do not hold/);
    const inBase = giveProgressCards(bare(base), 0, ["resourceMonopoly"]);
    expect(() => apply(inBase, { playerId: 0, action: { type: "playProgressCard", cardId: "resourceMonopoly", payload: { resource: "ore" } } }, base)).toThrow(/not part of this rule set/);
    expect(legalActions(inBase, base, 0).some((a) => a.type === "playProgressCard")).toBe(false);
    // legalActions enumerates exactly the playable cards with bounded payloads
    const listed = playableProgressCards(s, ck, 0).map((c) => c.cardId);
    expect(listed).toEqual(["resourceMonopoly"]);
  });
});

describe("cards", () => {
  it("Resource Monopoly takes up to 2 of a resource from each opponent", () => {
    let s = giveProgressCards(bare(ck), 0, ["resourceMonopoly"]);
    s = giveResources(s, 1, { ore: 3 });
    s = giveResources(s, 2, { ore: 1 });
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "resourceMonopoly", payload: { resource: "ore" } } }, ck);
    expect(after.players.map((p) => p.resources.ore)).toEqual([3, 1, 0]);
    expect(after.players[0]!.progressCards).toEqual([]);
    expect(after.progressDecks.trade.discard).toContain("resourceMonopoly");
  });

  it("Trade Monopoly takes 1 of a commodity from each opponent", () => {
    let s = giveProgressCards(bare(ck), 0, ["tradeMonopoly"]);
    s = giveCommodities(s, 1, { cloth: 2 });
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "tradeMonopoly", payload: { commodity: "cloth" } } }, ck);
    expect(after.players.map((p) => p.commodities.cloth)).toEqual([1, 1, 0]);
  });

  it("Merchant Fleet makes one card 2:1 for the turn, then lapses", () => {
    let s = giveProgressCards(bare(ck), 0, ["merchantFleet", "merchantFleet"]);
    const wood = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "merchantFleet", payload: { card: "wood" } } }, ck);
    expect(tradeRatiosFor(wood, ck, 0).wood).toBe(2);
    expect(tradeRatiosFor(wood, ck, 0).brick).toBe(4);
    const cloth = apply(wood, { playerId: 0, action: { type: "playProgressCard", cardId: "merchantFleet", payload: { card: "cloth" } } }, ck);
    expect(commodityTradeRatioFor(cloth, ck, 0, "cloth")).toBe(2);
    expect(commodityTradeRatioFor(cloth, ck, 0, "coin")).toBe(4);
    const ended = apply(cloth, { playerId: 0, action: { type: "endTurn" } }, ck);
    expect(ended.players[0]!.merchantFleet).toBeUndefined();
  });

  it("Bishop moves the robber and steals one card from every opponent on the hex", () => {
    const hex = ck.board.hexes[3]!.id;
    const { vertices } = ringOf(hex);
    let s = giveProgressCards(bare(ck), 0, ["bishop"]);
    s = withBuilding(s, vertices[0]!, 1, "settlement");
    s = withBuilding(s, vertices[3]!, 2, "city");
    s = giveResources(s, 1, { wood: 1 });
    s = giveCommodities(s, 2, { coin: 1 });
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "bishop", payload: { hex } } }, ck);
    expect(after.board.robberHex).toBe(hex);
    expect(after.players[1]!.resources.wood).toBe(0);
    expect(after.players[2]!.commodities.coin).toBe(0);
    expect(after.players[0]!.resources.wood + after.players[0]!.commodities.coin).toBe(2);
    expect(() => apply(giveProgressCards(after, 0, ["bishop"]), { playerId: 0, action: { type: "playProgressCard", cardId: "bishop", payload: { hex } } }, ck)).toThrow(/different hex/);
  });

  it("Warlord activates all your knights; unplayable with none inactive", () => {
    const { vertices } = ringOf(ck.board.hexes[3]!.id);
    let s = giveProgressCards(bare(ck), 0, ["warlord"]);
    expect(playableProgressCards(s, ck, 0)).toEqual([]);
    s = withKnight(s, vertices[0]!, 0);
    s = withKnight(s, vertices[2]!, 0, { level: 2 });
    s = withKnight(s, vertices[4]!, 1);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "warlord" } }, ck);
    expect(after.board.knights[vertices[0]!]).toMatchObject({ active: true, activatedThisTurn: true });
    expect(after.board.knights[vertices[2]!]).toMatchObject({ active: true });
    expect(after.board.knights[vertices[4]!]).toMatchObject({ active: false });
  });

  it("Spy takes a chosen card from an opponent, only if it is held and your hand has room", () => {
    let s = giveProgressCards(bare(ck), 0, ["spy"]);
    s = giveProgressCards(s, 1, ["inventor", "mining"]);
    const options = playableProgressCards(s, ck, 0)[0]!.payloads;
    expect(options).toEqual([{ playerId: 1, cardId: "inventor" }, { playerId: 1, cardId: "mining" }]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "spy", payload: { playerId: 1, cardId: "mining" } } }, ck);
    expect(after.players[0]!.progressCards).toEqual(["mining"]);
    expect(after.players[1]!.progressCards).toEqual(["inventor"]);
    expect(() => apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "spy", payload: { playerId: 1, cardId: "bishop" } } }, ck)).toThrow(/does not hold/);
    const full = giveProgressCards(s, 0, ["a", "b", "c"].map(() => "warlord"));
    expect(playableProgressCards(full, ck, 0).find((c) => c.cardId === "spy")).toBeUndefined();
  });

  it("Irrigation and Mining pay 2 per adjacent field / mountain, capped by the bank", () => {
    const geometry = getGeometry(ck.board);
    const wheatHex = ck.board.hexes.find((h) => h.resource === "wheat")!;
    const vertex = [...geometry.vertexHexes.entries()].find(([, hs]) => hs.includes(wheatHex.id))![0];
    const fields = (geometry.vertexHexes.get(vertex) ?? []).filter((h) => ck.board.hexes.find((x) => x.id === h)!.resource === "wheat").length;
    let s = giveProgressCards(bare(ck), 0, ["irrigation", "mining"]);
    s = withBuilding(s, vertex, 0, "settlement");
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "irrigation" } }, ck);
    expect(after.players[0]!.resources.wheat).toBe(2 * fields);
    expect(after.bank.wheat).toBe(19 - 2 * fields);
    const capped = apply({ ...s, bank: { ...s.bank, wheat: 1 } }, { playerId: 0, action: { type: "playProgressCard", cardId: "irrigation" } }, ck);
    expect(capped.players[0]!.resources.wheat).toBe(1);
    const noOre = ck.board.hexes.filter((h) => h.resource === "ore").every((h) => !(geometry.vertexHexes.get(vertex) ?? []).includes(h.id));
    if (noOre) expect(playableProgressCards(after, ck, 0).find((c) => c.cardId === "mining")).toBeUndefined();
  });

  it("Road Building places two free roads on your network", () => {
    const { edges, vertices } = ringOf(ck.board.hexes[3]!.id);
    let s = giveProgressCards(bare(ck), 0, ["roadBuilding"]);
    s = withBuilding(s, vertices[0]!, 0, "settlement");
    const payload = playableProgressCards(s, ck, 0)[0]!.payloads[0] as { edges: string[] };
    expect(payload.edges).toHaveLength(2);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "roadBuilding", payload } }, ck);
    expect(Object.values(after.board.roads).filter((o) => o === 0)).toHaveLength(2);
    expect(after.players[0]!.resources).toEqual(s.players[0]!.resources); // free
    void edges;
  });

  it("Inventor swaps two movable tokens; production follows the moved tokens; 2/6/8/12 stay put", () => {
    const rs = testRuleSet({ citiesAndKnights: true }); // varied tokens
    const movable = rs.board.hexes.filter((h) => h.numberToken !== null && ![2, 6, 8, 12].includes(h.numberToken));
    const [a, b] = [movable[0]!, movable.find((h) => h.numberToken !== movable[0]!.numberToken)!];
    let s = giveProgressCards(bare(rs), 0, ["inventor"]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "inventor", payload: { hexA: a.id, hexB: b.id } } }, rs);
    expect(after.board.tokenOverrides).toEqual({ [a.id]: b.numberToken, [b.id]: a.numberToken });
    expect(rs.board.hexes.find((h) => h.id === a.id)!.numberToken).toBe(a.numberToken); // layout untouched
    // A city on hex A now produces on B's old number.
    const v = ringOf(a.id).vertices[0]!;
    const withCity = withBuilding(after, v, 0, "city");
    const paid = productionForRoll(withCity, rs, b.numberToken!);
    expect(paid.gains.get(0)).toBeDefined();
    const fixed = rs.board.hexes.find((h) => h.numberToken === 6)!;
    expect(() => apply(giveProgressCards(after, 0, ["inventor"]), { playerId: 0, action: { type: "playProgressCard", cardId: "inventor", payload: { hexA: fixed.id, hexB: a.id } } }, rs)).toThrow(/cannot be moved/);
  });

  it("Alchemist fixes the production dice for the coming roll; the event die still rolls", () => {
    let s = giveProgressCards(bare(ck), 0, ["alchemist"]);
    s = { ...s, turn: { current: 0, phase: "rollDice" } };
    expect(playableProgressCards(s, ck, 0)[0]!.payloads).toHaveLength(36);
    const set = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "alchemist", payload: { dice: [6, 5] } } }, ck);
    expect(set.alchemistDice).toEqual([6, 5]);
    const rolled = apply(set, { playerId: 0, action: { type: "rollDice" } }, ck);
    expect(rolled.dice).toEqual([6, 5]);
    expect(rolled.alchemistDice).toBeUndefined();
    expect(rolled.eventDie).toBeDefined();
    expect(() => apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "alchemist", payload: { dice: [7, 1] } } }, ck)).toThrow(/1 to 6/);
  });

  it("Smith promotes up to two knights for free, respecting the Fortress and per-level limits", () => {
    const { vertices } = ringOf(ck.board.hexes[3]!.id);
    let s = giveProgressCards(bare(ck), 0, ["smith", "smith"]);
    s = withKnight(s, vertices[0]!, 0);
    s = withKnight(s, vertices[2]!, 0, { level: 2 });
    const opts = playableProgressCards(s, ck, 0)[0]!.payloads as { vertices: string[] }[];
    // vertex 2 is strong and cannot become mighty without the Fortress, so only vertex 0 is promotable
    expect(opts).toEqual([{ vertices: [vertices[0]!] }]);
    const after = apply(s, { playerId: 0, action: { type: "playProgressCard", cardId: "smith", payload: { vertices: [vertices[0]!] } } }, ck);
    expect(after.board.knights[vertices[0]!]!.level).toBe(2);
    const fortified = withImprovement(after, 0, "politics", 3);
    const both = playableProgressCards(fortified, ck, 0)[0]!.payloads as { vertices: string[] }[];
    expect(both).toContainEqual({ vertices: [vertices[0]!, vertices[2]!] });
    const mighty = apply(fortified, { playerId: 0, action: { type: "playProgressCard", cardId: "smith", payload: { vertices: [vertices[0]!, vertices[2]!] } } }, ck);
    expect(mighty.board.knights[vertices[0]!]!.level).toBe(3);
    expect(mighty.board.knights[vertices[2]!]!.level).toBe(3);
  });
});

describe("persistence and older saves", () => {
  it("a state paused on a progress discard survives a JSON round trip and still offers the choice", () => {
    let s = giveProgressCards(bare(ck), 0, ["bishop", "warlord", "spy", "mining", "inventor"]);
    s = { ...s, dice: [3, 3], pendingProgressDiscards: [0], turn: { current: 0, phase: "progressDiscard" } };
    const back = normalizeState(JSON.parse(JSON.stringify(s)) as GameState);
    expect(back).toEqual(s);
    expect(legalActions(back, ck, 0).filter((a) => a.type === "discardProgressCard")).toHaveLength(5);
  });

  it("saves from before slice 3 normalize with empty decks, hands and overrides", () => {
    const old = JSON.parse(JSON.stringify(newGame(base))) as Record<string, unknown>;
    delete old.progressDecks;
    (old.board as Record<string, unknown>).tokenOverrides = undefined;
    for (const p of old.players as Record<string, unknown>[]) {
      delete p.progressCards;
      delete p.progressVictoryPoints;
    }
    const fixed = normalizeState(old as unknown as GameState);
    expect(fixed.progressDecks.trade).toEqual({ draw: [], discard: [] });
    expect(fixed.board.tokenOverrides).toEqual({});
    expect(fixed.players[0]!.progressCards).toEqual([]);
    expect(fixed.players[0]!.progressVictoryPoints).toBe(0);
  });
});
