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
  /** Last error from the server or the connection; cleared on the next successful message. */
  error?: string;
  connected: boolean;
}

const STORAGE_KEY = "catan.session";

interface StoredSession {
  code: string;
  name: string;
  seatToken: string;
}

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:2567`;
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

function loadSession(): StoredSession | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : undefined;
  } catch {
    return undefined;
  }
}

function saveSession(session: StoredSession | undefined): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — a refresh just won't reclaim the seat
  }
}

function wire(r: Room, options: JoinOptions): void {
  room = r;
  set({ screen: "lobby", code: options.code, name: options.name, connected: true, error: undefined });

  r.onMessage(EVT.seat, (seat: SeatPayload) => {
    saveSession({ code: options.code, name: options.name, seatToken: seat.seatToken });
    set({ seat });
  });
  r.onMessage(EVT.room, (snapshot: RoomSnapshot) => {
    set({ snapshot, screen: snapshot.started ? "game" : "lobby" });
  });
  r.onMessage(EVT.ruleset, (ruleSet: RuleSet) => set({ ruleSet }));
  r.onMessage(EVT.game, (game: GameState) => set({ game, screen: "game", error: undefined }));
  r.onMessage(EVT.error, (err: ErrorPayload) => set({ error: err.message }));

  r.onError((code, message) => set({ error: `connection error ${code}: ${message ?? ""}` }));
  r.onLeave((code) => {
    if (room !== r) return; // an older connection we already replaced
    room = undefined;
    if (code === CLOSE_SUPERSEDED) {
      // Another tab/device took this seat with our token. Don't fight it.
      saveSession(undefined);
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
    const session = loadSession();
    if (!session || room) return;
    const ok = await tryConnect("join", session);
    if (!ok && loadSession()) scheduleReconnect();
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
      saveSession(undefined);
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
    if (options.seatToken) saveSession(undefined);
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

export function joinRoom(code: string, name: string): Promise<void> {
  return connect("join", { code: code.trim().toUpperCase(), name });
}

/** Try to get back into the room from the last session (page refresh). */
export async function resumeSession(): Promise<boolean> {
  const session = loadSession();
  if (!session) return false;
  await connect("join", session);
  return state.connected;
}

export function leaveRoom(): void {
  saveSession(undefined);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  reconnectAttempt = 0;
  const r = room;
  room = undefined;
  void r?.leave();
  state = { screen: "home", code: "", name: state.name, connected: false };
  for (const l of listeners) l();
}

export function startGame(): void {
  room?.send(MSG.start);
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
