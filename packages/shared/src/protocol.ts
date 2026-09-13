// The client <-> server wire protocol. Both apps import from here so the
// message names and payloads have exactly one definition.
//
// The server is authoritative (SPEC.md §1): clients only ever send intents
// (`Action`s) and receive full `GameState` snapshots back. The player a
// message comes from is derived server-side from the connection, never
// read from the payload.

import type { Action, GameState, RuleSet } from "./types.js";

export const ROOM_NAME = "catan";
/** Seats a room can hold — 5 for "Home Large — 5 Seats"; base rules recommend at most 4. */
export const MAX_PLAYERS = 5;
export const MIN_PLAYERS = 2;

/** Build identity, shown at startup, in the lobby, and stored with every match. */
export interface BuildInfo {
  appVersion: string;
  gitCommit: string;
  buildProfile: "dev" | "home-lan" | "production";
  mapGenerationVersion: string;
}

export type SeatKind = "human" | "bot";

/** Options a client passes when creating or joining a room. */
export interface JoinOptions {
  /** Short shareable room code; rooms are matched on this. */
  code: string;
  name: string;
  /** Returned by an earlier `seat` message — lets a refreshed page reclaim its seat. */
  seatToken?: string;
  /** Only the host's create sets this; a join for an unknown code is refused, not conjured. */
  create?: boolean;
}

/** Close code sent to a connection whose seat was reclaimed by a newer one. */
export const CLOSE_SUPERSEDED = 4310;

export interface Seat {
  playerId: number;
  name: string;
  /** Bots are always "connected" — they live in the server. */
  connected: boolean;
  isHost: boolean;
  kind: SeatKind;
}

export interface RoomSnapshot {
  code: string;
  seats: Seat[];
  started: boolean;
  build: BuildInfo;
  /** Where this room's games are persisted (for the diagnostics line). */
  persistence: string;
}

/** Payload of `start`: which rule set to play. Omitted = the default (base). */
export interface StartOptions {
  ruleSetId?: string;
}

// Client -> server
export const MSG = {
  /** Host starts the game once enough seats are filled. Payload: `StartOptions`. */
  start: "start",
  /** A game intent. Payload: `Action`. */
  action: "action",
  /** Host adds a server-controlled bot to the next free seat (lobby only). */
  addBot: "addBot",
  /** Host removes a bot seat. Payload: `{ playerId }` (lobby only). */
  removeBot: "removeBot",
} as const;

// Server -> client
export const EVT = {
  /** Sent once to a client on join: which seat is theirs. */
  seat: "seat",
  /** Lobby snapshot, broadcast on every seat change. */
  room: "room",
  /** The RuleSet for this game (board layout etc.), sent when a game starts or is rejoined. */
  ruleset: "ruleset",
  /** Full authoritative GameState, broadcast after every applied action. */
  game: "game",
  /** A rejected intent or other problem, sent only to the offending client. */
  error: "error",
} as const;

export interface SeatPayload {
  playerId: number;
  seatToken: string;
}

export interface ErrorPayload {
  message: string;
}

export type RuleSetPayload = RuleSet;
export type GamePayload = GameState;
export type ActionPayload = Action;
