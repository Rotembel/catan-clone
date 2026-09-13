// Connection + client-side store. The client is a renderer (SPEC.md §1): it
// keeps whatever the server last sent and forwards intents. It never
// mutates game state itself.

import { Client, type Room } from "colyseus.js";
import {
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
    room = undefined;
    // 1000 = we left on purpose; anything else is a drop worth surfacing.
    set({ connected: false, error: code === 1000 ? undefined : "disconnected from the server" });
  });
}

async function connect(kind: "create" | "join", options: JoinOptions): Promise<void> {
  set({ screen: "connecting", error: undefined, code: options.code, name: options.name });
  const client = new Client(serverUrl());
  try {
    const r =
      kind === "create"
        ? await client.create(ROOM_NAME, options)
        : await client.join(ROOM_NAME, options);
    wire(r, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({ screen: "home", connected: false, error: friendlyJoinError(message) });
  }
}

function friendlyJoinError(message: string): string {
  if (/no rooms found/i.test(message)) return "No game with that code — check it and try again.";
  return message;
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
  const ok = state.connected;
  if (!ok) saveSession(undefined);
  return ok;
}

export function leaveRoom(): void {
  saveSession(undefined);
  void room?.leave();
  room = undefined;
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
