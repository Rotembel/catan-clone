// Deterministic fixtures for engine tests.
//
// These build their own RuleSet rather than importing @catan/rulesets, so
// the engine package never depends on the data package (the dependency only
// runs the other way). A fixed board also means tests can name an exact hex
// and know what it produces.

import type {
  BoardLayout,
  CitiesAndKnightsRules,
  Commodity,
  EdgeId,
  GameState,
  HexTile,
  ImprovementTrack,
  PortLayout,
  Resource,
  RuleSet,
  VertexId,
} from "@catan/shared";
import { axialToCube, buildBoardGeometry, hexagonAxials, hexKey } from "../src/board/index.js";
import { hexEdges, hexVertices } from "../src/board/geometry.js";
import { apply } from "../src/apply.js";
import { createRng } from "../src/rng.js";
import { addCommodities, addResources } from "../src/resources.js";
import { legalActions } from "../src/selectors/legalActions.js";
import { createInitialState } from "../src/state.js";

const COSTS: RuleSet["costs"] = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

const DEV_CARDS: RuleSet["devCards"] = [
  { id: "knight", label: "Knight", count: 14, kind: "knight" },
  { id: "victoryPoint", label: "Victory Point", count: 5, kind: "victoryPoint" },
  { id: "roadBuilding", label: "Road Building", count: 2, kind: "progress" },
  { id: "yearOfPlenty", label: "Year of Plenty", count: 2, kind: "progress" },
  { id: "monopoly", label: "Monopoly", count: 2, kind: "progress" },
];

/** Resources cycle in a fixed order; hex index 0 is the desert. */
const RESOURCE_CYCLE: Resource[] = ["wood", "brick", "sheep", "wheat", "ore"];

/** The standard expansion block, spelled out here so engine tests don't depend on @catan/rulesets. */
export const TEST_CK_RULES: CitiesAndKnightsRules = {
  commodityFor: { sheep: "cloth", ore: "coin", wood: "paper" },
  trackCommodity: { trade: "cloth", politics: "coin", science: "paper" },
  improvementCosts: [1, 2, 3, 4, 5],
  commodityPortLevel: 3,
  setupSecondPlacementIsCity: true,
  commodityBankPerType: 12,
  eventDie: ["barbarian", "barbarian", "barbarian", "trade", "politics", "science"],
  barbarianTrackLength: 7,
  knightCosts: { build: { sheep: 1, ore: 1 }, activate: { wheat: 1 }, promote: { sheep: 1, ore: 1 } },
  knightsPerLevel: 2,
  fortressLevel: 3,
};

export interface TestRuleSetOptions {
  radius?: number;
  victoryPoints?: number;
  tradeDevCards?: boolean;
  /** Attach the Cities & Knights block (slice 1). */
  citiesAndKnights?: boolean;
  /** Every non-desert hex gets this number token, so one roll pays everyone. */
  uniformNumberToken?: number;
}

export function testBoardLayout(options: TestRuleSetOptions = {}): BoardLayout {
  const axials = hexagonAxials(options.radius ?? 2);
  const hexes: HexTile[] = axials.map((axial, i) => {
    const cube = axialToCube(axial);
    const resource: Resource | "desert" = i === 0 ? "desert" : RESOURCE_CYCLE[i % RESOURCE_CYCLE.length]!;
    const numberToken =
      resource === "desert" ? null : (options.uniformNumberToken ?? ((i % 10) + 2 === 7 ? 8 : (i % 10) + 2));
    return { id: hexKey(cube), q: axial.q, r: axial.r, resource, numberToken };
  });

  // Two ports on real boundary edges: one 2:1 wood, one 3:1 generic.
  const geometry = buildBoardGeometry(axials);
  const boundary: EdgeId[] = [];
  for (const [edge, hexIds] of geometry.edgeHexes) {
    if (hexIds.length === 1) boundary.push(edge);
  }
  boundary.sort();
  // The two ports must not share a vertex, or a single building would sit on
  // both and the ratios under test would overlap.
  const firstEdge = boundary[0]!;
  const firstVertices = geometry.edgeVertices.get(firstEdge)!;
  const secondEdge = boundary.find((edge) => {
    const vs = geometry.edgeVertices.get(edge)!;
    return !vs.some((v) => firstVertices.includes(v));
  })!;

  const ports: PortLayout[] = [
    {
      id: "port-wood-2",
      vertexIds: firstVertices,
      ratio: 2,
      resource: "wood",
    },
    {
      id: "port-generic-3",
      vertexIds: geometry.edgeVertices.get(secondEdge)!,
      ratio: 3,
      resource: null,
    },
  ];

  return { hexes, ports };
}

export function testRuleSet(options: TestRuleSetOptions = {}): RuleSet {
  return {
    id: "test",
    victoryPoints: options.victoryPoints ?? 10,
    costs: COSTS,
    devCards: DEV_CARDS,
    board: testBoardLayout(options),
    houseRules: { tradeDevCards: options.tradeDevCards ?? false },
    ...(options.citiesAndKnights ? { citiesAndKnights: { ...TEST_CK_RULES } } : {}),
  };
}

export function newGame(
  ruleSet: RuleSet,
  playerNames = ["Ada", "Grace"],
  seed = "test-seed"
): GameState {
  return createInitialState(ruleSet, { playerNames, rngState: createRng(seed) });
}

/**
 * Runs the opening placement phase by always taking the first legal action,
 * leaving the game at the first player's "rollDice".
 */
export function playSetup(state: GameState, ruleSet: RuleSet): GameState {
  let next = state;
  let guard = 0;
  while (next.turn.phase.startsWith("setup")) {
    if (guard++ > 100) throw new Error("setup did not finish");
    const playerId = next.players[next.turn.current]!.id;
    const options = legalActions(next, ruleSet, playerId);
    const action = options[0];
    if (!action) throw new Error(`no legal setup action for player ${playerId}`);
    next = apply(next, { playerId, action }, ruleSet);
  }
  return next;
}

// --- direct state edits, for arranging a board a test wants to assert on ---

export function withBuilding(
  state: GameState,
  vertex: VertexId,
  playerId: number,
  kind: "settlement" | "city" = "settlement"
): GameState {
  return {
    ...state,
    board: { ...state.board, buildings: { ...state.board.buildings, [vertex]: { playerId, kind } } },
  };
}

export function withKnight(
  state: GameState,
  vertex: VertexId,
  playerId: number,
  options: { level?: 1 | 2 | 3; active?: boolean; activatedThisTurn?: boolean } = {}
): GameState {
  return {
    ...state,
    board: {
      ...state.board,
      knights: {
        ...state.board.knights,
        [vertex]: {
          playerId,
          level: options.level ?? 1,
          active: options.active ?? false,
          activatedThisTurn: options.activatedThisTurn ?? false,
        },
      },
    },
  };
}

export function withRoads(state: GameState, playerId: number, edges: EdgeId[]): GameState {
  const roads = { ...state.board.roads };
  for (const edge of edges) roads[edge] = playerId;
  return { ...state, board: { ...state.board, roads } };
}

export function giveResources(
  state: GameState,
  playerId: number,
  amount: Partial<Record<Resource, number>>
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, resources: addResources(p.resources, amount) } : p
    ),
  };
}

export function giveCommodities(
  state: GameState,
  playerId: number,
  amount: Partial<Record<Commodity, number>>
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, commodities: addCommodities(p.commodities, amount) } : p
    ),
  };
}

export function withImprovement(
  state: GameState,
  playerId: number,
  track: ImprovementTrack,
  level: number
): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, improvements: { ...p.improvements, [track]: level } } : p
    ),
  };
}

export function giveDevCard(state: GameState, playerId: number, cardId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, devCards: [...p.devCards, cardId] } : p
    ),
  };
}

export function inMainTurn(state: GameState, playerIndex = 0): GameState {
  return { ...state, turn: { current: playerIndex, phase: "mainTurn" } };
}

/** The 6 edges and 6 vertices around a hex, for building known-shape networks. */
export function ringOf(hexId: string): { edges: EdgeId[]; vertices: VertexId[] } {
  const [x, y, z] = hexId.split(",").map(Number);
  const cube = { x: x!, y: y!, z: z! };
  return { edges: hexEdges(cube), vertices: hexVertices(cube) };
}
