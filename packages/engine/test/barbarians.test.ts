// Cities & Knights slice 2: the event die, the barbarian track, and attack
// resolution. Attack logic is tested as a pure step (resolveBarbarianAttack)
// and end to end through rollDice.

import { describe, expect, it } from "vitest";
import { apply } from "../src/apply.js";
import { advanceBarbarians, barbarianStrength, knightStrength, resolveBarbarianAttack } from "../src/reducers/barbarians.js";
import { IllegalActionError } from "../src/reducers/helpers.js";
import { totalVictoryPoints } from "../src/selectors/victory.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { inMainTurn, newGame, playSetup, ringOf, testRuleSet, withBuilding, withKnight } from "./fixtures.js";
import type { GameState, RuleSet } from "@catan/shared";

const ck = testRuleSet({ citiesAndKnights: true, uniformNumberToken: 6 });
const base = testRuleSet({ uniformNumberToken: 6 });

/** Two players, empty board, in player 0's rollDice phase. */
function atRoll(ruleSet: RuleSet): GameState {
  const g = newGame(ruleSet);
  return { ...g, board: { ...g.board, buildings: {}, roads: {} }, turn: { current: 0, phase: "rollDice" } };
}

const spots = ringOf(ck.board.hexes[3]!.id).vertices; // six vertices of one hex
const far = ringOf(ck.board.hexes[9]!.id).vertices;

describe("event die", () => {
  it("rolls a face from the rule set alongside the dice, deterministically", () => {
    const s = atRoll(ck);
    const a = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
    const b = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
    expect(a.eventDie).toBeDefined();
    expect(ck.citiesAndKnights!.eventDie).toContain(a.eventDie);
    expect(a.eventDie).toBe(b.eventDie);
    expect(a.dice).toEqual(b.dice);
  });

  it("over many rolls shows every face, barbarians most often", () => {
    let s = atRoll(ck);
    const seen = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const next = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
      seen.set(next.eventDie!, (seen.get(next.eventDie!) ?? 0) + 1);
      s = { ...s, rngState: next.rngState };
    }
    expect([...seen.keys()].sort()).toEqual(["barbarian", "politics", "science", "trade"]);
    expect(seen.get("barbarian")!).toBeGreaterThan(seen.get("trade")! * 1.5);
  });

  it("is not rolled in the base game: same seed, same dice as before, no event, no ship", () => {
    const s = atRoll(base);
    const next = apply(s, { playerId: 0, action: { type: "rollDice" } }, base);
    expect(next.eventDie).toBeUndefined();
    expect(next.barbarianPosition).toBe(0);
    // The RNG advanced by exactly the two dice: the third draw after the
    // roll equals what a fresh two-dice draw from the pre-roll state yields.
    const ckNext = apply({ ...s }, { playerId: 0, action: { type: "rollDice" } }, ck);
    expect(ckNext.dice).toEqual(next.dice); // same first two draws
    expect(ckNext.rngState).not.toBe(next.rngState); // C&K consumed one more
  });
});

describe("barbarian advance", () => {
  it("moves one step per barbarian face and attacks at the end of the track", () => {
    let s = atRoll(ck);
    for (let i = 1; i < 7; i++) {
      s = advanceBarbarians(s, ck);
      expect(s.barbarianPosition).toBe(i);
    }
    const attacked = advanceBarbarians(s, ck);
    expect(attacked.barbarianPosition).toBe(0);
  });

  it("reaches an attack through real rolls, and the roll still pays out afterwards", () => {
    let s = atRoll(ck);
    s = withBuilding(s, spots[0]!, 0, "city"); // 1 city, no knights -> barbarians win
    let attacks = 0;
    for (let i = 0; i < 400 && attacks === 0; i++) {
      const before = s.barbarianPosition;
      const next = apply(s, { playerId: 0, action: { type: "rollDice" } }, ck);
      if (next.eventDie === "barbarian" && before === 6) {
        attacks++;
        expect(next.barbarianPosition).toBe(0);
        // The only city was downgraded automatically (one city, no choice)...
        expect(next.board.buildings[spots[0]!]?.kind).toBe("settlement");
        // ...and the roll then resolved normally.
        expect(["mainTurn", "discard", "moveRobberAfterSeven"]).toContain(next.turn.phase);
      }
      s = { ...s, rngState: next.rngState, barbarianPosition: next.barbarianPosition, board: s.board };
    }
    expect(attacks).toBe(1);
  });
});

describe("barbarian attack", () => {
  function twoCitiesEach(): GameState {
    let s = inMainTurn(atRoll(ck));
    s = withBuilding(s, spots[0]!, 0, "city");
    s = withBuilding(s, spots[2]!, 0, "city");
    s = withBuilding(s, far[0]!, 1, "city");
    s = withBuilding(s, far[2]!, 1, "city");
    return s;
  }

  it("counts cities as barbarian strength and active knights as Catan's", () => {
    let s = twoCitiesEach();
    s = withKnight(s, spots[4]!, 0, { level: 2, active: true });
    s = withKnight(s, far[4]!, 1, { level: 3, active: false });
    expect(barbarianStrength(s)).toBe(4);
    expect(knightStrength(s, 0)).toBe(2);
    expect(knightStrength(s, 1)).toBe(0); // inactive knights don't count
  });

  it("successful defence: the single strongest defender becomes Defender of Catan (+1 VP); knights stand down", () => {
    let s = twoCitiesEach();
    s = withKnight(s, spots[4]!, 0, { level: 2, active: true });
    s = withKnight(s, far[4]!, 1, { level: 2, active: true });
    s = withKnight(s, far[5]!, 1, { level: 1, active: true }); // Catan 5 >= 4 cities
    const before0 = totalVictoryPoints(s, ck, 0);
    const before1 = totalVictoryPoints(s, ck, 1);

    const after = resolveBarbarianAttack(s);
    expect(after.players[1]!.defenderOfCatan).toBe(1);
    expect(after.players[0]!.defenderOfCatan).toBe(0);
    expect(Object.values(after.board.buildings).filter((b) => b?.kind === "city")).toHaveLength(4);
    expect(Object.values(after.board.knights).every((k) => k && !k.active)).toBe(true);
    expect(after.barbarianPosition).toBe(0);
    expect(after.turn.phase).toBe("mainTurn");
    expect(totalVictoryPoints(after, ck, 1)).toBe(before1 + 1);
    expect(totalVictoryPoints(after, ck, 0)).toBe(before0);
  });

  it("a tied defence awards nobody (progress cards arrive in slice 3)", () => {
    let s = twoCitiesEach();
    s = withKnight(s, spots[4]!, 0, { level: 2, active: true });
    s = withKnight(s, far[4]!, 1, { level: 2, active: true });
    const after = resolveBarbarianAttack(s);
    expect(after.players.map((p) => p.defenderOfCatan)).toEqual([0, 0]);
  });

  it("failed defence: the weakest player with cities loses one; a lone city is downgraded at once", () => {
    let s = twoCitiesEach();
    s = withKnight(s, spots[4]!, 0, { level: 1, active: true }); // Catan 1 < 4
    // Player 1 has 0 strength and two cities -> must choose; player 0 (strength 1) is safe.
    const after = resolveBarbarianAttack(s);
    expect(after.turn.phase).toBe("barbarianDowngrade");
    expect(after.pendingDowngrades).toEqual([1]);
    expect(Object.values(after.board.buildings).filter((b) => b?.kind === "city")).toHaveLength(4);

    // With only one city, the loss is automatic and play continues.
    let lone = inMainTurn(atRoll(ck));
    lone = withBuilding(lone, spots[0]!, 0, "city");
    lone = withBuilding(lone, far[0]!, 1, "settlement");
    const lost = resolveBarbarianAttack(lone);
    expect(lost.board.buildings[spots[0]!]?.kind).toBe("settlement");
    expect(lost.turn.phase).toBe("mainTurn");
    expect(lost.pendingDowngrades).toBeUndefined();
  });

  it("everyone tied at the bottom loses a city; players without cities are ignored", () => {
    let s = inMainTurn(atRoll(ck));
    s = withBuilding(s, spots[0]!, 0, "city");
    s = withBuilding(s, far[0]!, 1, "city");
    const after = resolveBarbarianAttack(s);
    expect(after.board.buildings[spots[0]!]?.kind).toBe("settlement");
    expect(after.board.buildings[far[0]!]?.kind).toBe("settlement");
  });

  it("downgradeCity: only pending players, only their own cities, then the roll resolves", () => {
    let s = twoCitiesEach();
    s = { ...s, dice: [3, 3], turn: { current: 0, phase: "rollDice" } };
    s = resolveBarbarianAttack(s); // both at 0 strength -> both owe a city
    expect(s.pendingDowngrades).toEqual([0, 1]);

    const choices = legalActions(s, ck, 1).filter((a) => a.type === "downgradeCity");
    expect(choices.map((a) => (a as { vertex: string }).vertex).sort()).toEqual([far[0]!, far[2]!].sort());

    expect(() => apply(s, { playerId: 0, action: { type: "downgradeCity", vertex: far[0]! } }, ck)).toThrow(IllegalActionError);
    expect(() => apply(s, { playerId: 1, action: { type: "buildRoad", edge: "e:x|y" } }, ck)).toThrow(IllegalActionError);

    const one = apply(s, { playerId: 1, action: { type: "downgradeCity", vertex: far[2]! } }, ck);
    expect(one.board.buildings[far[2]!]?.kind).toBe("settlement");
    expect(one.turn.phase).toBe("barbarianDowngrade");
    expect(one.pendingDowngrades).toEqual([0]);
    expect(() => apply(one, { playerId: 1, action: { type: "downgradeCity", vertex: far[0]! } }, ck)).toThrow(/does not owe/);

    const two = apply(one, { playerId: 0, action: { type: "downgradeCity", vertex: spots[2]! } }, ck);
    expect(two.pendingDowngrades).toBeUndefined();
    expect(two.turn.phase).toBe("mainTurn"); // the 6 that was rolled paid out
    expect(two.players[0]!.resources.sheep + two.players[0]!.resources.wood + two.players[0]!.resources.ore + two.players[0]!.resources.wheat + two.players[0]!.resources.brick).toBeGreaterThan(0);
  });
});

describe("base-game regression with Cities & Knights disabled", () => {
  it("no knights, no ship, no defender, and the new actions are illegal", () => {
    const s = playSetup(newGame(base), base);
    expect(s.board.knights).toEqual({});
    expect(s.barbarianPosition).toBe(0);
    expect(s.players.every((p) => p.defenderOfCatan === 0)).toBe(true);
    const main = inMainTurn(s);
    const v = Object.keys(main.board.buildings)[0]!;
    for (const action of [
      { type: "buildKnight", vertex: v },
      { type: "activateKnight", vertex: v },
      { type: "promoteKnight", vertex: v },
      { type: "moveKnight", from: v, to: v },
      { type: "downgradeCity", vertex: v },
    ] as const) {
      expect(() => apply(main, { playerId: 0, action }, base)).toThrow(IllegalActionError);
    }
    expect(legalActions(main, base, 0).some((a) => /Knight|downgrade/.test(a.type))).toBe(false);
    expect(advanceBarbarians(main, base)).toBe(main);
  });
});
