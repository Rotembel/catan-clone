import { describe, expect, it } from "vitest";
import { apply, IllegalActionError, tryApply } from "../src/apply.js";
import { getGeometry } from "../src/geometryCache.js";
import { productionForRoll, tradeRatiosFor } from "../src/selectors/production.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { totalCards } from "../src/resources.js";
import { stealTargetsAt } from "../src/reducers/robber.js";
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

/** A game that has finished setup and is on player 0's main turn. */
function started() {
  return inMainTurn(playSetup(newGame(ruleSet), ruleSet));
}

describe("building", () => {
  it("charges the cost, returns it to the bank, and places the piece", () => {
    let state = started();
    const bankBefore = { ...state.bank };
    state = giveResources(state, 0, { wood: 1, brick: 1 });

    const roadAction = legalActions(state, ruleSet, 0).find((a) => a.type === "buildRoad")!;
    const edge = (roadAction as { edge: string }).edge;
    const after = apply(state, { playerId: 0, action: roadAction }, ruleSet);

    expect(after.board.roads[edge]).toBe(0);
    expect(after.players[0]!.resources.wood).toBe(state.players[0]!.resources.wood - 1);
    expect(after.players[0]!.resources.brick).toBe(state.players[0]!.resources.brick - 1);
    expect(after.bank.wood).toBe(bankBefore.wood + 1);
  });

  it("rejects building without resources, and leaves state untouched", () => {
    const state = started();
    const snapshot = JSON.stringify(state);
    const broke = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
      })),
    };
    const geometry = getGeometry(ruleSet.board);
    const someEdge = [...geometry.edgeVertices.keys()][0]!;

    const result = tryApply(broke, { playerId: 0, action: { type: "buildRoad", edge: someEdge } }, ruleSet);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("upgrades a settlement to a city, and refuses a city where there's no settlement", () => {
    let state = started();
    const ownSettlement = Object.entries(state.board.buildings).find(
      ([, b]) => b?.playerId === 0 && b.kind === "settlement"
    )![0];
    state = giveResources(state, 0, { wheat: 2, ore: 3 });

    const after = apply(
      state,
      { playerId: 0, action: { type: "buildCity", vertex: ownSettlement } },
      ruleSet
    );
    expect(after.board.buildings[ownSettlement]).toEqual({ playerId: 0, kind: "city" });

    expect(() =>
      apply(after, { playerId: 0, action: { type: "buildCity", vertex: ownSettlement } }, ruleSet)
    ).toThrow(IllegalActionError);
  });

  it("won't build a settlement that isn't connected to the player's roads", () => {
    let state = started();
    state = giveResources(state, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
    const geometry = getGeometry(ruleSet.board);

    const connected = new Set(
      legalActions(state, ruleSet, 0)
        .filter((a) => a.type === "buildSettlement")
        .map((a) => (a as { vertex: string }).vertex)
    );
    const disconnected = [...geometry.vertexHexes.keys()].find(
      (v) => !connected.has(v) && state.board.buildings[v] === undefined
    )!;

    expect(() =>
      apply(state, { playerId: 0, action: { type: "buildSettlement", vertex: disconnected } }, ruleSet)
    ).toThrow(IllegalActionError);
  });
});

describe("production", () => {
  it("pays 1 for a settlement and 2 for a city", () => {
    const hex = ruleSet.board.hexes.find((h) => h.resource !== "desert" && h.numberToken !== null)!;
    const { vertices } = ringOf(hex.id);
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {}, robberHex: "0,0,0" } };
    state = withBuilding(state, vertices[0]!, 0, "settlement");
    state = withBuilding(state, vertices[2]!, 1, "city");

    const { gains } = productionForRoll(state, ruleSet, hex.numberToken!);
    expect(gains.get(0)?.[hex.resource as "wood"]).toBe(1);
    expect(gains.get(1)?.[hex.resource as "wood"]).toBe(2);
  });

  it("pays nothing on the robber's hex", () => {
    const hex = ruleSet.board.hexes.find((h) => h.resource !== "desert" && h.numberToken !== null)!;
    const { vertices } = ringOf(hex.id);
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {}, robberHex: hex.id } };
    state = withBuilding(state, vertices[0]!, 0, "settlement");

    const { gains } = productionForRoll(state, ruleSet, hex.numberToken!);
    expect(gains.get(0)).toBeUndefined();
  });

  it("pays nobody when the bank can't cover every claimant", () => {
    const hex = ruleSet.board.hexes.find((h) => h.resource !== "desert" && h.numberToken !== null)!;
    const resource = hex.resource as "wood";
    const { vertices } = ringOf(hex.id);
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {}, robberHex: "0,0,0" } };
    state = withBuilding(state, vertices[0]!, 0, "settlement");
    state = withBuilding(state, vertices[2]!, 1, "settlement");
    state = { ...state, bank: { ...state.bank, [resource]: 1 } };

    const { gains, bank } = productionForRoll(state, ruleSet, hex.numberToken!);
    expect(gains.get(0)).toBeUndefined();
    expect(gains.get(1)).toBeUndefined();
    expect(bank[resource]).toBe(1);
  });

  it("rollDice hands out exactly what productionForRoll predicts", () => {
    const state = playSetup(newGame(ruleSet), ruleSet);
    const after = apply(state, { playerId: 0, action: { type: "rollDice" } }, ruleSet);
    const roll = after.dice![0] + after.dice![1];

    if (roll === 7) {
      expect(["discard", "moveRobberAfterSeven"]).toContain(after.turn.phase);
      return;
    }

    expect(after.turn.phase).toBe("mainTurn");
    const { gains } = productionForRoll(state, ruleSet, roll);
    for (const player of after.players) {
      const before = state.players.find((p) => p.id === player.id)!;
      const gain = gains.get(player.id) ?? {};
      expect(player.resources.wood).toBe(before.resources.wood + (gain.wood ?? 0));
      expect(player.resources.ore).toBe(before.resources.ore + (gain.ore ?? 0));
    }
  });
});

describe("robber", () => {
  it("steals exactly one card from a chosen victim on that hex", () => {
    const base = started();
    const hex = ruleSet.board.hexes.find((h) => h.id !== base.board.robberHex)!;
    const { vertices } = ringOf(hex.id);
    let state = base;
    state = withBuilding(state, vertices[0]!, 1);
    state = giveResources(state, 1, { wheat: 3 });
    state = { ...state, turn: { current: 0, phase: "moveRobberAfterSeven" } };

    expect(stealTargetsAt(state, ruleSet, hex.id, 0)).toContain(1);

    const after = apply(
      state,
      { playerId: 0, action: { type: "moveRobber", hex: hex.id, stealFrom: 1 } },
      ruleSet
    );
    expect(after.board.robberHex).toBe(hex.id);
    expect(totalCards(after.players[1]!.resources)).toBe(totalCards(state.players[1]!.resources) - 1);
    expect(totalCards(after.players[0]!.resources)).toBe(totalCards(state.players[0]!.resources) + 1);
    expect(after.turn.phase).toBe("mainTurn");
  });

  it("refuses to stay put, and refuses a steal with no victim there", () => {
    let state = started();
    state = { ...state, turn: { current: 0, phase: "moveRobberAfterSeven" } };

    expect(() =>
      apply(state, { playerId: 0, action: { type: "moveRobber", hex: state.board.robberHex } }, ruleSet)
    ).toThrow(IllegalActionError);

    const emptyHex = ruleSet.board.hexes.find(
      (h) => h.id !== state.board.robberHex && ringOf(h.id).vertices.every((v) => !state.board.buildings[v])
    )!;
    expect(() =>
      apply(
        state,
        { playerId: 0, action: { type: "moveRobber", hex: emptyHex.id, stealFrom: 1 } },
        ruleSet
      )
    ).toThrow(IllegalActionError);
  });
});

describe("bank and port trades", () => {
  it("defaults to 4:1", () => {
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {} } };
    expect(tradeRatiosFor(state, ruleSet, 0).ore).toBe(4);

    state = giveResources(state, 0, { ore: 4 });
    const after = apply(
      state,
      {
        playerId: 0,
        action: {
          type: "proposeTrade",
          offer: { fromPlayerId: 0, give: { ore: 4 }, receive: { wheat: 1 } },
        },
      },
      ruleSet
    );
    expect(after.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore - 4);
    expect(after.players[0]!.resources.wheat).toBe(state.players[0]!.resources.wheat + 1);
  });

  it("rejects a 4:1 trade offered at the wrong rate", () => {
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {} } };
    state = giveResources(state, 0, { ore: 4 });
    expect(() =>
      apply(
        state,
        {
          playerId: 0,
          action: {
            type: "proposeTrade",
            offer: { fromPlayerId: 0, give: { ore: 4 }, receive: { wheat: 2 } },
          },
        },
        ruleSet
      )
    ).toThrow(IllegalActionError);
  });

  it("gives 3:1 at a generic port and 2:1 at that resource's own port", () => {
    const generic = ruleSet.board.ports.find((p) => p.resource === null)!;
    const wood = ruleSet.board.ports.find((p) => p.resource === "wood")!;

    let state = started();
    state = { ...state, board: { ...state.board, buildings: {} } };
    state = withBuilding(state, generic.vertexIds[0], 0);
    expect(tradeRatiosFor(state, ruleSet, 0).ore).toBe(3);
    expect(tradeRatiosFor(state, ruleSet, 0).wood).toBe(3);

    state = withBuilding(state, wood.vertexIds[0], 0);
    expect(tradeRatiosFor(state, ruleSet, 0).wood).toBe(2);
    expect(tradeRatiosFor(state, ruleSet, 0).ore).toBe(3);

    // And the port ratio is what the reducer actually charges.
    state = giveResources(state, 0, { wood: 2 });
    const after = apply(
      state,
      {
        playerId: 0,
        action: {
          type: "proposeTrade",
          offer: { fromPlayerId: 0, give: { wood: 2 }, receive: { ore: 1 } },
        },
      },
      ruleSet
    );
    expect(after.players[0]!.resources.wood).toBe(state.players[0]!.resources.wood - 2);
    expect(after.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 1);
  });

  it("only gives a port to a player who actually built on it", () => {
    let state = started();
    state = { ...state, board: { ...state.board, buildings: {} } };
    const wood = ruleSet.board.ports.find((p) => p.resource === "wood")!;
    state = withBuilding(state, wood.vertexIds[0], 1);
    expect(tradeRatiosFor(state, ruleSet, 0).wood).toBe(4);
    expect(tradeRatiosFor(state, ruleSet, 1).wood).toBe(2);
  });
});

describe("player-to-player trade", () => {
  it("swaps resources when accepted, and clears when rejected", () => {
    let state = started();
    state = giveResources(state, 0, { wood: 2 });
    state = giveResources(state, 1, { ore: 1 });

    const offer = { fromPlayerId: 0, toPlayerId: 1, give: { wood: 2 }, receive: { ore: 1 } };
    const proposed = apply(state, { playerId: 0, action: { type: "proposeTrade", offer } }, ruleSet);
    expect(proposed.pendingTrade).toEqual(offer);

    const rejected = apply(proposed, { playerId: 1, action: { type: "respondTrade", accept: false } }, ruleSet);
    expect(rejected.pendingTrade).toBeUndefined();
    expect(rejected.players[0]!.resources.wood).toBe(state.players[0]!.resources.wood);

    const accepted = apply(proposed, { playerId: 1, action: { type: "respondTrade", accept: true } }, ruleSet);
    expect(accepted.players[0]!.resources.wood).toBe(state.players[0]!.resources.wood - 2);
    expect(accepted.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 1);
    expect(accepted.players[1]!.resources.wood).toBe(state.players[1]!.resources.wood + 2);
    expect(accepted.players[1]!.resources.ore).toBe(state.players[1]!.resources.ore - 1);
  });

  it("blocks dev cards in a trade unless the house rule is on", () => {
    let state = started();
    state = giveDevCard(state, 0, "knight");
    const offer = {
      fromPlayerId: 0,
      toPlayerId: 1,
      give: {},
      receive: { ore: 1 },
      giveDevCards: ["knight"],
    };

    expect(() =>
      apply(state, { playerId: 0, action: { type: "proposeTrade", offer } }, ruleSet)
    ).toThrow(IllegalActionError);

    const houseRuled = testRuleSet({ tradeDevCards: true });
    let hrState = inMainTurn(playSetup(newGame(houseRuled), houseRuled));
    hrState = giveDevCard(hrState, 0, "knight");
    hrState = giveResources(hrState, 1, { ore: 1 });
    const proposed = apply(hrState, { playerId: 0, action: { type: "proposeTrade", offer } }, houseRuled);
    const accepted = apply(proposed, { playerId: 1, action: { type: "respondTrade", accept: true } }, houseRuled);
    expect(accepted.players[1]!.devCards).toContain("knight");
    expect(accepted.players[0]!.devCards).not.toContain("knight");
  });
});

describe("development cards", () => {
  it("buys from the deck and can't be played the same turn", () => {
    let state = started();
    state = giveResources(state, 0, { sheep: 1, wheat: 1, ore: 1 });
    const deckBefore = state.devDeck.length;

    const after = apply(state, { playerId: 0, action: { type: "buyDevCard" } }, ruleSet);
    expect(after.devDeck.length).toBe(deckBefore - 1);
    expect(after.players[0]!.devCards).toHaveLength(1);

    const bought = after.players[0]!.devCards[0]!;
    if (bought !== "victoryPoint") {
      expect(() =>
        apply(after, { playerId: 0, action: { type: "playDevCard", cardId: bought, payload: {} } }, ruleSet)
      ).toThrow(IllegalActionError);
    }
  });

  it("refuses to buy from an empty deck (deck depletion)", () => {
    let state = started();
    state = giveResources(state, 0, { sheep: 1, wheat: 1, ore: 1 });
    state = { ...state, devDeck: [] };
    expect(() => apply(state, { playerId: 0, action: { type: "buyDevCard" } }, ruleSet)).toThrow(
      IllegalActionError
    );
  });

  it("allows only one dev card per turn", () => {
    const base = started();
    const hexes = ruleSet.board.hexes.filter((h) => h.id !== base.board.robberHex);
    let state = base;
    state = giveDevCard(state, 0, "knight");
    state = giveDevCard(state, 0, "knight");

    const after = apply(
      state,
      { playerId: 0, action: { type: "playDevCard", cardId: "knight", payload: { hex: hexes[0]!.id } } },
      ruleSet
    );
    expect(after.players[0]!.playedKnights).toBe(1);

    expect(() =>
      apply(
        after,
        { playerId: 0, action: { type: "playDevCard", cardId: "knight", payload: { hex: hexes[1]!.id } } },
        ruleSet
      )
    ).toThrow(IllegalActionError);
  });

  it("monopoly takes every card of one resource from everyone else", () => {
    let state = started();
    state = giveDevCard(state, 0, "monopoly");
    state = giveResources(state, 1, { sheep: 3 });
    const before0 = state.players[0]!.resources.sheep;

    const after = apply(
      state,
      { playerId: 0, action: { type: "playDevCard", cardId: "monopoly", payload: { resource: "sheep" } } },
      ruleSet
    );
    expect(after.players[1]!.resources.sheep).toBe(0);
    expect(after.players[0]!.resources.sheep).toBe(before0 + 3);
  });

  it("year of plenty draws 2 from the bank", () => {
    let state = started();
    state = giveDevCard(state, 0, "yearOfPlenty");
    const bankOre = state.bank.ore;

    const after = apply(
      state,
      {
        playerId: 0,
        action: { type: "playDevCard", cardId: "yearOfPlenty", payload: { resources: ["ore", "ore"] } },
      },
      ruleSet
    );
    expect(after.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 2);
    expect(after.bank.ore).toBe(bankOre - 2);
  });

  it("road building places two roads for free", () => {
    let state = started();
    state = giveDevCard(state, 0, "roadBuilding");
    const woodBefore = state.players[0]!.resources.wood;
    const action = legalActions(state, ruleSet, 0).find(
      (a) => a.type === "playDevCard" && a.cardId === "roadBuilding"
    )!;
    const edges = (action as { payload: { edges: string[] } }).payload.edges;

    const after = apply(state, { playerId: 0, action }, ruleSet);
    for (const edge of edges) expect(after.board.roads[edge]).toBe(0);
    expect(after.players[0]!.resources.wood).toBe(woodBefore);
  });

  it("won't 'play' a victory point card", () => {
    let state = started();
    state = giveDevCard(state, 0, "victoryPoint");
    expect(() =>
      apply(state, { playerId: 0, action: { type: "playDevCard", cardId: "victoryPoint" } }, ruleSet)
    ).toThrow(IllegalActionError);
  });
});

describe("discarding on a seven", () => {
  it("makes players over the limit discard half, then moves to the robber", () => {
    let state = started();
    state = giveResources(state, 1, { wood: 4, brick: 4 }); // 8 cards -> discard 4
    state = {
      ...state,
      turn: { current: 0, phase: "discard" },
      pendingDiscards: [1],
    };

    expect(() =>
      apply(state, { playerId: 1, action: { type: "discardCards", discard: { wood: 1 } } }, ruleSet)
    ).toThrow(IllegalActionError);

    const after = apply(
      state,
      { playerId: 1, action: { type: "discardCards", discard: { wood: 2, brick: 2 } } },
      ruleSet
    );
    expect(totalCards(after.players[1]!.resources)).toBe(4);
    expect(after.pendingDiscards).toBeUndefined();
    expect(after.turn.phase).toBe("moveRobberAfterSeven");
  });
});

describe("turn flow", () => {
  it("endTurn passes to the next player and resets per-turn dev card flags", () => {
    let state = started();
    state = giveDevCard(state, 0, "knight");
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === 0 ? { ...p, hasPlayedDevCardThisTurn: true, devCardsBoughtThisTurn: ["knight"] } : p
      ),
    };

    const after = apply(state, { playerId: 0, action: { type: "endTurn" } }, ruleSet);
    expect(after.turn).toEqual({ current: 1, phase: "rollDice" });
    expect(after.players[0]!.hasPlayedDevCardThisTurn).toBe(false);
    expect(after.players[0]!.devCardsBoughtThisTurn).toEqual([]);
  });

  it("won't let a player act out of phase", () => {
    const state = started();
    expect(() => apply(state, { playerId: 0, action: { type: "rollDice" } }, ruleSet)).toThrow(
      IllegalActionError
    );
  });
});

describe("immutability", () => {
  it("never mutates the state handed in", () => {
    let state = started();
    state = giveResources(state, 0, { wood: 1, brick: 1 });
    const snapshot = JSON.stringify(state);

    const action = legalActions(state, ruleSet, 0).find((a) => a.type === "buildRoad")!;
    apply(state, { playerId: 0, action }, ruleSet);

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
