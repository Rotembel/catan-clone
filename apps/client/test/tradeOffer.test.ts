import { describe, expect, it } from "vitest";
import { apply, createInitialState, legalActions } from "@catan/engine";
import { createRuleSet } from "@catan/rulesets";
import type { GameState } from "@catan/shared";
import { bankOffer, playerOffer, sideSummary } from "../src/components/tradeOffer.js";
import { narrate } from "../src/components/narrate.js";

function ckMainTurn(me = 0): { state: GameState; ruleSet: ReturnType<typeof createRuleSet>["ruleSet"] } {
  const { ruleSet, state: rng } = createRuleSet("cities-and-knights", { seed: "trade-test" });
  const fresh = createInitialState(ruleSet, { playerNames: ["Ada", "Bot Grace", "Bot Alan"], rngState: rng });
  const state: GameState = {
    ...fresh,
    turn: { ...fresh.turn, current: me, phase: "mainTurn" },
    players: fresh.players.map((p) =>
      p.id === me ? { ...p, resources: { ...p.resources, wood: 4, brick: 1 }, commodities: { ...p.commodities, cloth: 2 } } : p
    ),
  };
  return { state, ruleSet };
}

describe("bank / port trade dialog → offer", () => {
  it("a complete selection always yields an offer the engine accepts (C&K, resources and commodities)", () => {
    const { state, ruleSet } = ckMainTurn();
    const me = state.players[0]!;
    const ctx = { held: (c: string) => (c in me.resources ? (me.resources as never)[c] : (me.commodities as never)[c]) as number, inBank: () => 19, ratio: () => 4 };
    const offer = bankOffer(0, { give: "wood", receive: "ore" }, ctx as never);
    expect(offer).toEqual({ fromPlayerId: 0, give: { wood: 4 }, receive: { ore: 1 } });
    const next = apply(state, { playerId: 0, action: { type: "proposeTrade", offer: offer! } }, ruleSet);
    expect(next.players[0]!.resources).toMatchObject({ wood: 0, ore: 1 });
    expect(next.pendingTrade).toBeUndefined(); // bank trades resolve at once — nothing pending
  });

  it("no offer (button disabled) while the selection is incomplete or unaffordable", () => {
    const ctx = { held: (c: string) => (c === "wood" ? 3 : 0), inBank: (c: string) => (c === "ore" ? 0 : 5), ratio: () => 4 };
    expect(bankOffer(0, { give: null, receive: "ore" }, ctx as never)).toBeUndefined();
    expect(bankOffer(0, { give: "wood", receive: "wood" }, ctx as never)).toBeUndefined();
    expect(bankOffer(0, { give: "wood", receive: "sheep" }, ctx as never)).toBeUndefined(); // holds 3 < ratio 4
    expect(bankOffer(0, { give: "brick", receive: "ore" }, ctx as never)).toBeUndefined(); // bank has no ore
  });
});

describe("player trade dialog → offer → bot response (the real-game path)", () => {
  it("complete selection ⇒ offer; engine puts it on the table for the other player; a decline clears it and the turn continues", () => {
    const { state, ruleSet } = ckMainTurn();
    const offer = playerOffer(0, { to: 1, give: { wood: 2, brick: 0 }, receive: { ore: 1 } });
    expect(offer).toEqual({ fromPlayerId: 0, toPlayerId: 1, give: { wood: 2 }, receive: { ore: 1 } });
    const pending = apply(state, { playerId: 0, action: { type: "proposeTrade", offer: offer! } }, ruleSet);
    expect(pending.pendingTrade).toEqual(offer);
    // Only the counterpart can answer; the proposer keeps its turn otherwise.
    expect(legalActions(pending, ruleSet, 1).map((a) => a.type)).toEqual(["respondTrade", "respondTrade"]);
    const after = apply(pending, { playerId: 1, action: { type: "respondTrade", accept: false } }, ruleSet);
    expect(after.pendingTrade).toBeUndefined();
    expect(legalActions(after, ruleSet, 0).some((a) => a.type === "endTurn")).toBe(true);
  });

  it("incomplete selections never produce an offer", () => {
    expect(playerOffer(0, { to: 1, give: {}, receive: { ore: 1 } })).toBeUndefined();
    expect(playerOffer(0, { to: 1, give: { wood: 1 }, receive: {} })).toBeUndefined();
    expect(playerOffer(0, { to: 0, give: { wood: 1 }, receive: { ore: 1 } })).toBeUndefined();
    expect(playerOffer(0, { to: undefined, give: { wood: 1 }, receive: { ore: 1 } })).toBeUndefined();
    expect(playerOffer(0, { to: 1, give: {}, receive: { ore: 1 }, giveDevCards: ["knight"] })?.giveDevCards).toEqual(["knight"]);
  });

  it("the footer summary names both sides", () => {
    expect(sideSummary({ wood: 2, ore: 0 }, undefined, (c) => c)).toBe("2 wood");
    expect(sideSummary({}, ["knight"], (c) => c)).toBe("1 📜");
    expect(sideSummary({}, undefined, (c) => c)).toBe("nothing");
  });
});

describe("narration from the authoritative last action", () => {
  it("names the roll, the event die and the bot's trade answer", () => {
    const { state, ruleSet } = ckMainTurn();
    const rolled = { ...state, dice: [3, 5] as [number, number], eventDie: "barbarian" as const };
    expect(narrate({ playerId: 1, action: { type: "rollDice" } }, rolled, ruleSet, 0)).toBe("Bot Grace rolled 8 (3+5) · ⛵ barbarians");
    expect(narrate({ playerId: 1, action: { type: "respondTrade", accept: false } }, state, ruleSet, 0)).toBe("Bot Grace declined the trade");
    expect(narrate({ playerId: 0, action: { type: "buildRoad", edge: "e:x" } }, state, ruleSet, 0)).toBe("You built a road");
    expect(narrate(undefined, state, ruleSet, 0)).toBeUndefined();
  });
});
