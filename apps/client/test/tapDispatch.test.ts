import { describe, expect, it } from "vitest";
import { apply, createInitialState, getGeometry, legalActions } from "@catan/engine";
import { createRuleSet } from "@catan/rulesets";
import type { Action, GameState } from "@catan/shared";
import { edgeTapAction, vertexTapAction } from "../src/components/tapDispatch.js";

const V = "v:0,0,0", W = "v:1,1,1", E = "e:0";

describe("vertexTapAction — one-tap targets resolve straight to an action", () => {
  it("buildKnight mode sends buildKnight only for a currently-legal vertex", () => {
    const legal: Action[] = [{ type: "buildKnight", vertex: V }];
    expect(vertexTapAction({ kind: "buildKnight" }, legal, V)).toEqual({ type: "buildKnight", vertex: V });
    expect(vertexTapAction({ kind: "buildKnight" }, legal, W)).toBeUndefined();
    // Same tap, but the legal list moved on (new server state): nothing is sent.
    expect(vertexTapAction({ kind: "buildKnight" }, [], V)).toBeUndefined();
  });

  it("moveKnight mode covers free moves and displacement (both listed by the engine)", () => {
    const legal: Action[] = [
      { type: "moveKnight", from: V, to: W },
      { type: "moveKnight", from: "v:9,9,9", to: "v:8,8,8" },
    ];
    expect(vertexTapAction({ kind: "moveKnight", from: V }, legal, W)).toEqual({ type: "moveKnight", from: V, to: W });
    expect(vertexTapAction({ kind: "moveKnight", from: V }, legal, "v:8,8,8")).toBeUndefined();
  });

  it("respondVertex / progressVertex send the engine-listed payload", () => {
    const legal: Action[] = [
      { type: "respondInteraction", payload: { vertex: V } },
      { type: "playProgressCard", cardId: "bishop", payload: { vertex: W } },
    ];
    expect(vertexTapAction({ kind: "respondVertex" }, legal, V)).toEqual({ type: "respondInteraction", payload: { vertex: V } });
    expect(vertexTapAction({ kind: "respondVertex" }, legal, W)).toBeUndefined();
    expect(vertexTapAction({ kind: "progressVertex", cardId: "bishop" }, legal, W)).toEqual({ type: "playProgressCard", cardId: "bishop", payload: { vertex: W } });
    expect(vertexTapAction({ kind: "progressVertex", cardId: "other" }, legal, W)).toBeUndefined();
  });

  it("idle mode: metropolis, downgrade, wall, city, settlement — in that priority", () => {
    const one = (type: Action["type"]) => vertexTapAction({ kind: "idle" }, [{ type, vertex: V } as Action], V);
    for (const type of ["placeMetropolis", "downgradeCity", "buildWall", "buildCity", "buildSettlement"] as const) {
      expect(one(type)).toEqual({ type, vertex: V });
    }
    const both: Action[] = [{ type: "buildCity", vertex: V }, { type: "placeMetropolis", vertex: V }];
    expect(vertexTapAction({ kind: "idle" }, both, V)?.type).toBe("placeMetropolis");
    expect(vertexTapAction({ kind: "idle" }, both, W)).toBeUndefined();
  });

  it("menu / hex-only modes never send a vertex action", () => {
    const legal: Action[] = [{ type: "buildSettlement", vertex: V }, { type: "buildKnight", vertex: V }];
    for (const kind of ["knightMenu", "devKnight", "victim", "inventor", "progressHex", "roadBuilding"]) {
      expect(vertexTapAction({ kind }, legal, V)).toBeUndefined();
    }
  });
});

describe("edgeTapAction", () => {
  it("resolves road, response and progress edges, each against the current legal list", () => {
    const legal: Action[] = [
      { type: "buildRoad", edge: E },
      { type: "respondInteraction", payload: { edge: E } },
      { type: "playProgressCard", cardId: "diplomat", payload: { edge: E } },
    ];
    expect(edgeTapAction({ kind: "idle" }, legal, E)).toEqual({ type: "buildRoad", edge: E });
    expect(edgeTapAction({ kind: "respondEdge" }, legal, E)).toEqual({ type: "respondInteraction", payload: { edge: E } });
    expect(edgeTapAction({ kind: "progressEdge", cardId: "diplomat" }, legal, E)).toEqual({ type: "playProgressCard", cardId: "diplomat", payload: { edge: E } });
    expect(edgeTapAction({ kind: "idle" }, [], E)).toBeUndefined();
    expect(edgeTapAction({ kind: "buildKnight" }, legal, E)).toBeUndefined();
  });
});

describe("Build Knight through the engine (the iPad bug's full path)", () => {
  it("tap → buildKnight → knight on the vertex, cost paid, target no longer legal", () => {
    const { ruleSet, state: rng } = createRuleSet("cities-and-knights", { seed: "tap-test" });
    const fresh = createInitialState(ruleSet, { playerNames: ["Ada", "Grace"], rngState: rng });
    const ck = ruleSet.citiesAndKnights!;
    const [edge] = [...getGeometry(ruleSet.board).edgeVertices.keys()];
    const me = 0;
    const state: GameState = {
      ...fresh,
      turn: { ...fresh.turn, current: me, phase: "mainTurn" },
      board: { ...fresh.board, roads: { [edge!]: me } },
      players: fresh.players.map((p) => (p.id === me ? { ...p, resources: { ...p.resources, sheep: 1, ore: 1 } } : p)),
    };
    const legal = legalActions(state, ruleSet, me);
    const vertex = legal.find((a) => a.type === "buildKnight")?.vertex;
    expect(vertex).toBeDefined();

    const action = vertexTapAction({ kind: "buildKnight" }, legal, vertex!);
    expect(action).toEqual({ type: "buildKnight", vertex });
    const next = apply(state, { playerId: me, action: action! }, ruleSet);

    expect(next.board.knights[vertex!]).toMatchObject({ playerId: me, level: 1, active: false });
    expect(next.players[me]!.resources.sheep).toBe(state.players[me]!.resources.sheep - ck.knightCosts.build.sheep!);
    expect(next.players[me]!.resources.ore).toBe(state.players[me]!.resources.ore - ck.knightCosts.build.ore!);

    // The client re-derives legality from the new state: the same tap is now inert.
    const after = legalActions(next, ruleSet, me);
    expect(vertexTapAction({ kind: "buildKnight" }, after, vertex!)).toBeUndefined();
    expect(() => apply(next, { playerId: me, action: action! }, ruleSet)).toThrow();
  });
});
