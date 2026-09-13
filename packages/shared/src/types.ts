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
  | "mainTurn"
  | "moveRobberAfterSeven"
  | "gameOver";

export interface Player {
  id: number;
  name: string;
  resources: Record<Resource, number>;
  /** Dev card ids currently in hand (unplayed). */
  devCards: string[];
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
  /** undefined = open offer to all other players, or a bank/port trade. */
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
  winner?: number;
  /** Serialized seeded RNG — keeps the engine pure (see CLAUDE.md). */
  rngState: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

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
  | { type: "endTurn" };

/** Every action carries this envelope at the server boundary (SPEC.md §4). */
export interface ActionEnvelope {
  playerId: number;
  action: Action;
}
