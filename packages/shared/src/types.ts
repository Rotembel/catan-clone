// Shared types — the single source of truth for GameState / Action / RuleSet.
// Imported by engine, server, and client alike. Do not redeclare these
// elsewhere (see CLAUDE.md "One type source").
//
// Shapes follow SPEC.md §4, filled in where the spec says "shape, not final".

export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

/** Cities & Knights: the second card layer, produced only by cities. */
export type Commodity = "cloth" | "coin" | "paper";
/** Anything that can sit in a hand, be traded, discarded, or stolen. */
export type Card = Resource | Commodity;
export type CardCounts = Partial<Record<Card, number>>;

/** Cities & Knights city-improvement tracks. */
export type ImprovementTrack = "trade" | "politics" | "science";

/** Cities & Knights event die faces: three barbarian ships and one city gate per track. */
export type EventDieFace = "barbarian" | "trade" | "politics" | "science";

/** Knight strength: 1 basic, 2 strong, 3 mighty. */
export type KnightLevel = 1 | 2 | 3;

/** Opaque canonical id for a board hex — see engine/board for how these are derived. */
export type HexId = string;
/** Opaque canonical id for a settlement/city spot (a hex-grid vertex). */
export type VertexId = string;
/** Opaque canonical id for a road spot (a hex-grid edge). */
export type EdgeId = string;

export type BuildKind = "road" | "settlement" | "city" | "devCard";

// ---------------------------------------------------------------------------
// Board layout (data, part of a RuleSet)
// ---------------------------------------------------------------------------

export interface HexTile {
  id: HexId;
  q: number;
  r: number;
  resource: Resource | "desert";
  /** Dice-roll number token, 2-12. null on the desert (no token). */
  numberToken: number | null;
}

export interface PortLayout {
  id: string;
  /** The two adjacent vertices a ship must have a settlement/city on to use this port. */
  vertexIds: [VertexId, VertexId];
  ratio: number;
  /** null = generic port (any resource at `ratio`). */
  resource: Resource | null;
}

export interface BoardLayout {
  hexes: HexTile[];
  ports: PortLayout[];
}

// ---------------------------------------------------------------------------
// Rules (data-driven — see CLAUDE.md "Rules are data")
// ---------------------------------------------------------------------------

export interface HouseRules {
  /** HOUSE RULE #1 — default false in the base game. */
  tradeDevCards: boolean;
}

export interface DevCardDef {
  id: string;
  label: string;
  count: number;
  kind: "knight" | "victoryPoint" | "progress";
}

/**
 * Cities & Knights (SPEC.md §7 Phase 5), as data. Present on a RuleSet =
 * the expansion is on; every reducer branch keys off this block, so the
 * base game never sees any of it. Later slices (event die, barbarians,
 * knights, progress cards, metropolises) add fields here.
 */
export interface CitiesAndKnightsRules {
  /** A city on one of these hexes yields 1 resource + 1 commodity instead of 2 resources. */
  commodityFor: Partial<Record<Resource, Commodity>>;
  /** Which commodity pays for each improvement track. */
  trackCommodity: Record<ImprovementTrack, Commodity>;
  /** Cost of each improvement level in that track's commodity; index 0 = level 1. */
  improvementCosts: number[];
  /** Trade level from which commodities trade 2:1 with the bank (the trading house). */
  commodityPortLevel: number;
  /** The second opening placement is a city, not a settlement. */
  setupSecondPlacementIsCity: boolean;
  /** How many of each commodity the bank starts with. */
  commodityBankPerType: number;
  /** The six faces of the event die (slice 2). */
  eventDie: EventDieFace[];
  /** Barbarian ship steps before an attack lands. */
  barbarianTrackLength: number;
  /** Knight costs, in resources. */
  knightCosts: {
    build: Partial<Record<Resource, number>>;
    activate: Partial<Record<Resource, number>>;
    promote: Partial<Record<Resource, number>>;
  };
  /** Knights a player may have at each level. */
  knightsPerLevel: number;
  /** Politics level required to promote a knight to mighty (the Fortress). */
  fortressLevel: number;
}

export interface RuleSet {
  id: string;
  victoryPoints: number;
  costs: Record<BuildKind, Partial<Record<Resource, number>>>;
  devCards: DevCardDef[];
  board: BoardLayout;
  houseRules: HouseRules;
  /** Undefined = base game. */
  citiesAndKnights?: CitiesAndKnightsRules;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type TurnPhase =
  | "setupSettlement1"
  | "setupRoad1"
  | "setupSettlement2"
  | "setupRoad2"
  | "rollDice"
  /** A 7 was rolled; players over the 7-card limit owe a discard (see `pendingDiscards`). */
  | "discard"
  | "mainTurn"
  | "moveRobberAfterSeven"
  /** Barbarians won and players in `pendingDowngrades` must choose which city to lose. */
  | "barbarianDowngrade"
  | "gameOver";

export interface Player {
  id: number;
  name: string;
  resources: Record<Resource, number>;
  /** Dev card ids currently in hand (unplayed). */
  devCards: string[];
  /**
   * Dev cards bought this turn — they can't be played until the next turn
   * (official rule). Cleared on endTurn.
   */
  devCardsBoughtThisTurn: string[];
  /** At most one dev card may be played per turn. Cleared on endTurn. */
  hasPlayedDevCardThisTurn: boolean;
  playedKnights: number;
  /** Public victory points only — hidden VP dev cards are not included. */
  victoryPoints: number;
  /** Cities & Knights; all zero in a base game. */
  commodities: Record<Commodity, number>;
  /** Cities & Knights improvement level per track (0-5); all zero in a base game. */
  improvements: Record<ImprovementTrack, number>;
  /** Defender of Catan awards held (1 VP each); always 0 in a base game. */
  defenderOfCatan: number;
}

export interface Knight {
  playerId: number;
  level: KnightLevel;
  active: boolean;
  /** Activated this turn — may not move until the next turn. Cleared on endTurn. */
  activatedThisTurn: boolean;
}

export interface Building {
  playerId: number;
  kind: "settlement" | "city";
}

export interface BoardState {
  buildings: Partial<Record<VertexId, Building>>;
  /** Edge -> the player who built the road there. */
  roads: Partial<Record<EdgeId, number>>;
  robberHex: HexId;
  /** Cities & Knights knights, by vertex; always empty in a base game. */
  knights: Partial<Record<VertexId, Knight>>;
}

export interface TradeOffer {
  fromPlayerId: number;
  /** undefined = a bank/port trade, resolved immediately by proposeTrade itself. */
  toPlayerId?: number;
  /** Resources, plus commodities when Cities & Knights is on. */
  give: CardCounts;
  receive: CardCounts;
  /** Only meaningful when ruleSet.houseRules.tradeDevCards is on. */
  giveDevCards?: string[];
  receiveDevCards?: string[];
}

export interface GameState {
  ruleSetId: string;
  players: Player[];
  turn: { current: number; phase: TurnPhase };
  board: BoardState;
  /** Remaining dev card ids, seeded-shuffled. */
  devDeck: string[];
  bank: Record<Resource, number>;
  /** Cities & Knights commodity supply; all zero in a base game. */
  commodityBank: Record<Commodity, number>;
  dice?: [number, number];
  pendingTrade?: TradeOffer;
  /** Player ids that still owe a discard during the "discard" phase. */
  pendingDiscards?: number[];
  /** Cities & Knights: how far the barbarian ship has sailed (0 = start); always 0 in a base game. */
  barbarianPosition: number;
  /** Cities & Knights: the event die face of the current roll. */
  eventDie?: EventDieFace;
  /** Players who lost the barbarian attack and hold several cities: they choose which to lose. */
  pendingDowngrades?: number[];
  /**
   * Current holders of the two bonus-VP awards. These are *state*, not
   * derived values: the official tie rule ("you only take it by strictly
   * beating the holder") depends on who got there first, which the board
   * alone doesn't say.
   */
  longestRoadPlayerId?: number;
  largestArmyPlayerId?: number;
  /** During setup, the settlement just placed — the road must connect to it. */
  setupLastSettlement?: VertexId;
  winner?: number;
  /** Serialized seeded RNG — keeps the engine pure (see CLAUDE.md). */
  rngState: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// SPEC.md §4 flags this union as "shape, not final". `discardCards` is the
// one addition Phase 1 needed: after a 7, a player holding >7 cards must
// discard half (rounded down) — a player decision the server has to receive
// as an action, not something the engine can decide unilaterally.
export type Action =
  | { type: "rollDice" }
  | { type: "buildRoad"; edge: EdgeId }
  | { type: "buildSettlement"; vertex: VertexId }
  | { type: "buildCity"; vertex: VertexId }
  | { type: "buyDevCard" }
  | { type: "playDevCard"; cardId: string; payload?: unknown }
  | { type: "proposeTrade"; offer: TradeOffer }
  | { type: "respondTrade"; accept: boolean }
  | { type: "moveRobber"; hex: HexId; stealFrom?: number }
  | { type: "discardCards"; discard: CardCounts }
  /** Cities & Knights: buy the next level on an improvement track. */
  | { type: "buildImprovement"; track: ImprovementTrack }
  /** Cities & Knights knights (slice 2). */
  | { type: "buildKnight"; vertex: VertexId }
  | { type: "activateKnight"; vertex: VertexId }
  | { type: "promoteKnight"; vertex: VertexId }
  | { type: "moveKnight"; from: VertexId; to: VertexId }
  /** Cities & Knights: after a lost barbarian attack, which of your cities becomes a settlement. */
  | { type: "downgradeCity"; vertex: VertexId }
  | { type: "endTurn" };

// playDevCard payloads, keyed by cardId — kept separate from the Action
// union itself (which types payload as `unknown`, per SPEC.md §4) so
// reducers have a concrete shape to validate against.

export interface MonopolyPayload {
  resource: Resource;
}

export interface YearOfPlentyPayload {
  resources: [Resource, Resource];
}

export interface RoadBuildingPayload {
  edges: EdgeId[]; // up to 2; fewer if the player can't place that many
}

export interface KnightPayload {
  hex: HexId;
  stealFrom?: number;
}

/** Every action carries this envelope at the server boundary (SPEC.md §4). */
export interface ActionEnvelope {
  playerId: number;
  action: Action;
}
