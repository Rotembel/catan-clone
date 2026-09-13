// Connection + client-side store. The client is a renderer (SPEC.md §1): it
// keeps whatever the server last sent and forwards intents. It never
// mutates game state itself.

import { Client, type Room } from "colyseus.js";
import {
  CLOSE_SUPERSEDED,
  EVT,
  MSG,
  ROOM_NAME,
  type Action,
  type ActionEnvelope,
  type ErrorPayload,
  type GameState,
  type JoinOptions,
  type RoomSnapshot,
  type RuleSet,
  type SeatPayload,
} from "@catan/shared";
import { useSyncExternalStore } from "react";

export type Screen = "home" | "connecting" | "lobby" | "game";

export interface NetState {
  screen: Screen;
  code: string;
  name: string;
  seat?: SeatPayload;
  snapshot?: RoomSnapshot;
  ruleSet?: RuleSet;
  game?: GameState;
  /** The action the server applied most recently (presentation only). */
  lastAction?: ActionEnvelope;
  /** Last error from the server or the connection; cleared on the next successful message. */
  error?: string;
  connected: boolean;
}

const STORAGE_KEY = "catan.sessions";

/** One seat credential per room, kept in localStorage so a killed tab or a fresh one can rejoin. */
export interface StoredSession {
  code: string;
  name: string;
  seatToken: string;
  savedAt: number;
}

interface SessionStore {
  last?: string;
  rooms: Record<string, StoredSession>;
}

/**
 * Where the game server lives. Derived from the page's own hostname so the
 * same build works on localhost and when a phone opens the LAN IP; override
 * with VITE_SERVER_URL (full URL) or VITE_SERVER_PORT (see .env.example).
 * Pure — takes the location and env so it can be unit-tested.
 */
export function deriveServerUrl(
  loc: { protocol: string; hostname: string },
  env: { VITE_SERVER_URL?: string; VITE_SERVER_PORT?: string }
): string {
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  const port = env.VITE_SERVER_PORT ?? "2567";
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${loc.hostname}:${port}`;
}

function serverUrl(): string {
  return deriveServerUrl(location, import.meta.env as Record<string, string | undefined>);
}

let state: NetState = { screen: "home", code: "", name: "", connected: false };
let room: Room | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<NetState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNet(): NetState {
  return useSyncExternalStore(subscribe, () => state);
}

function readStore(): SessionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SessionStore;
  } catch {
    // unavailable or corrupt — behave as if empty
  }
  return { rooms: {} };
}

function writeStore(store: SessionStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — a refresh just won't reclaim the seat
  }
}

/** The credential for a room (default: the room used most recently). */
function loadSession(code?: string): StoredSession | undefined {
  const store = readStore();
  const key = (code ?? store.last ?? "").toUpperCase();
  return key ? store.rooms[key] : undefined;
}

function saveSession(session: StoredSession): void {
  const store = readStore();
  store.rooms[session.code] = session;
  store.last = session.code;
  writeStore(store);
}

function clearSession(code: string): void {
  const store = readStore();
  delete store.rooms[code.toUpperCase()];
  if (store.last === code.toUpperCase()) store.last = undefined;
  writeStore(store);
}

/** Rooms this browser holds a seat in, most recent first — for the Resume buttons. */
export function storedSessions(): StoredSession[] {
  return Object.values(readStore().rooms).sort((a, b) => b.savedAt - a.savedAt);
}

function wire(r: Room, options: JoinOptions): void {
  room = r;
  set({ screen: "lobby", code: options.code, name: options.name, connected: true, error: undefined });

  r.onMessage(EVT.seat, (seat: SeatPayload) => {
    saveSession({ code: options.code, name: options.name, seatToken: seat.seatToken, savedAt: Date.now() });
    set({ seat });
  });
  r.onMessage(EVT.room, (snapshot: RoomSnapshot) => {
    set({ snapshot, screen: snapshot.started ? "game" : "lobby" });
  });
  r.onMessage(EVT.ruleset, (ruleSet: RuleSet) => set({ ruleSet }));
  r.onMessage(EVT.action, (lastAction: ActionEnvelope) => set({ lastAction }));
  r.onMessage(EVT.game, (game: GameState) => set({ game, screen: "game", error: undefined }));
  r.onMessage(EVT.error, (err: ErrorPayload) => set({ error: err.message }));

  r.onError((code, message) => set({ error: `connection error ${code}: ${message ?? ""}` }));
  r.onLeave((code) => {
    if (room !== r) return; // an older connection we already replaced
    room = undefined;
    if (code === CLOSE_SUPERSEDED) {
      // Another tab/device took this seat with our token. Don't fight it.
      clearSession(options.code);
      state = { screen: "home", code: "", name: state.name, connected: false, error: "You joined this game from another tab or device." };
      for (const l of listeners) l();
      return;
    }
    if (code === 1000) {
      set({ connected: false });
      return;
    }
    // A drop (or the server restarting). Keep trying to get the seat back;
    // the server rehydrates the game from its store, so nothing is lost.
    set({ connected: false, error: "Connection lost — reconnecting…" });
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
  reconnectAttempt++;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = undefined;
    const session = loadSession(state.code || undefined);
    if (!session || room) return;
    const ok = await tryConnect("join", session);
    if (!ok && loadSession(session.code)) scheduleReconnect();
  }, delay);
}

/** Connect without touching `screen` on failure — used by reconnects. */
async function tryConnect(kind: "create" | "join", options: JoinOptions): Promise<boolean> {
  const client = new Client(serverUrl());
  try {
    const r =
      kind === "create"
        ? await client.create(ROOM_NAME, { ...options, create: true })
        : await client.joinOrCreate(ROOM_NAME, options);
    reconnectAttempt = 0;
    wire(r, options);
    return true;
  } catch (error) {
    const message = describeError(error);
    // The room is genuinely gone (finished game, expired code): stop trying.
    if (/no game with that code|already started|room is full/i.test(message)) {
      clearSession(options.code);
      set({ screen: "home", connected: false, error: friendlyJoinError(message) });
    }
    return false;
  }
}

/** Definitive rejections — the room is gone or won't have us. Anything else is transient. */
const FATAL_JOIN = /no game with that code|no rooms found|already started|room is full/i;

async function connect(kind: "create" | "join", options: JoinOptions): Promise<void> {
  set({ screen: "connecting", error: undefined, code: options.code, name: options.name });
  const client = new Client(serverUrl());
  try {
    const r =
      kind === "create"
        ? await client.create(ROOM_NAME, { ...options, create: true })
        : await client.joinOrCreate(ROOM_NAME, options);
    reconnectAttempt = 0;
    wire(r, options);
  } catch (error) {
    const message = describeError(error);
    if (kind === "join" && options.seatToken && !FATAL_JOIN.test(message)) {
      // We hold a seat and the server is merely unreachable (restarting?).
      // Keep the token and keep knocking; the game is safe in its store.
      set({ screen: "connecting", connected: false, error: "Can't reach the server — retrying…" });
      scheduleReconnect();
      return;
    }
    if (options.seatToken) clearSession(options.code);
    set({ screen: "home", connected: false, error: friendlyJoinError(message) });
  }
}

/** Colyseus rejects with a raw Event when the socket itself fails; make that readable. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof Event !== "undefined" && error instanceof Event) return "could not reach the server";
  return String(error);
}

function friendlyJoinError(message: string): string {
  if (/no game with that code|no rooms found/i.test(message)) {
    return "No game with that code — check it and try again.";
  }
  return message.replace(/^.*?\d{4}\s*/, "") || message;
}

export function createRoom(name: string): Promise<void> {
  return connect("create", { code: randomCode(), name });
}

/**
 * Join by code. If this browser already holds a seat in that room, the seat
 * token rides along, so "Join" after a killed tab or app is a rejoin — the
 * name is display only and need not match.
 */
export function joinRoom(code: string, name: string): Promise<void> {
  const upper = code.trim().toUpperCase();
  const stored = loadSession(upper);
  return connect("join", { code: upper, name, seatToken: stored?.seatToken });
}

/** Get back into a room this browser holds a seat in (page refresh, or a Resume button). */
export async function resumeSession(code?: string): Promise<boolean> {
  const session = loadSession(code);
  if (!session) return false;
  await connect("join", { code: session.code, name: session.name, seatToken: session.seatToken });
  return state.connected;
}

export function forgetSession(code: string): void {
  clearSession(code);
  for (const l of listeners) l();
}

export function leaveRoom(): void {
  if (state.code) clearSession(state.code);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectAttempt = 0;
  const r = room;
  room = undefined;
  void r?.leave();
  state = { screen: "home", code: "", name: state.name, connected: false };
  for (const l of listeners) l();
}

export function startGame(ruleSetId: string): void {
  room?.send(MSG.start, { ruleSetId });
}

export function addBot(): void {
  room?.send(MSG.addBot);
}

export function removeBot(playerId: number): void {
  room?.send(MSG.removeBot, { playerId });
}

export function sendAction(action: Action): void {
  set({ error: undefined });
  room?.send(MSG.action, action);
}

export function clearError(): void {
  set({ error: undefined });
}

/** Room codes: 4 letters, no ambiguous glyphs. */
function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
