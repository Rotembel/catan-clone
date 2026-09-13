// Shared types — the single source of truth for GameState / Action / RuleSet.
// Imported by engine, server, and client alike. Do not redeclare these
// elsewhere (see CLAUDE.md "One type source").
//
// Shapes follow SPEC.md §4, filled in where the spec says "shape, not final".

export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

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

export interface RuleSet {
  id: string;
  victoryPoints: number;
  costs: Record<BuildKind, Partial<Record<Resource, number>>>;
  devCards: DevCardDef[];
  board: BoardLayout;
  houseRules: HouseRules;
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
}

export interface TradeOffer {
  fromPlayerId: number;
  /** undefined = a bank/port trade, resolved immediately by proposeTrade itself. */
  toPlayerId?: number;
  give: Partial<Record<Resource, number>>;
  receive: Partial<Record<Resource, number>>;
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
  dice?: [number, number];
  pendingTrade?: TradeOffer;
  /** Player ids that still owe a discard during the "discard" phase. */
  pendingDiscards?: number[];
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
  | { type: "discardCards"; discard: Partial<Record<Resource, number>> }
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
