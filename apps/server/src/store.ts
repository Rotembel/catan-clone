// Persistence (SPEC.md §7 Phase 3): the room writes its full record after
// every applied action, and a freshly created room for a known code loads
// it back. Killing the server therefore loses nothing — the next join
// rehydrates the game exactly where it was.
//
// The interface is deliberately tiny so Redis (prod) or SQLite can slot in
// later without touching the room. FileStore is the zero-dependency dev
// default; MemoryStore backs tests.

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildInfo, GameState, RuleSet, Seat } from "@catan/shared";

export interface StoredSeat extends Seat {
  token: string;
  /** A bot's own RNG state, threaded per decision so a restart replays identically. */
  botRng?: string;
}

export interface GameRecord {
  code: string;
  seats: StoredSeat[];
  ruleSet?: RuleSet;
  game?: GameState;
  /** The build that created this room. */
  build?: BuildInfo;
  createdAt: number;
  updatedAt: number;
}

export interface GameStore {
  load(code: string): Promise<GameRecord | undefined>;
  save(record: GameRecord): Promise<void>;
  delete(code: string): Promise<void>;
  list(): Promise<string[]>;
}

export class MemoryStore implements GameStore {
  private records = new Map<string, string>();

  async load(code: string): Promise<GameRecord | undefined> {
    const raw = this.records.get(code);
    return raw ? (JSON.parse(raw) as GameRecord) : undefined;
  }
  async save(record: GameRecord): Promise<void> {
    // Serialise on the way in so a stored record can't alias live state.
    this.records.set(record.code, JSON.stringify(record));
  }
  async delete(code: string): Promise<void> {
    this.records.delete(code);
  }
  async list(): Promise<string[]> {
    return [...this.records.keys()];
  }
  /** Test helper. */
  clear(): void {
    this.records.clear();
  }
}

const SAFE_CODE = /^[A-Z0-9]{1,16}$/;

export class FileStore implements GameStore {
  private writeSeq = 0;
  /** One write at a time per room, so overlapping saves land in order. */
  private chains = new Map<string, Promise<void>>();

  constructor(private readonly dir: string) {}

  private pathFor(code: string): string {
    if (!SAFE_CODE.test(code)) throw new Error(`refusing to use room code as a file name: ${code}`);
    return join(this.dir, `${code}.json`);
  }

  private async readRecord(path: string): Promise<GameRecord | undefined> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as GameRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async load(code: string): Promise<GameRecord | undefined> {
    const path = this.pathFor(code);
    try {
      return await this.readRecord(path);
    } catch (error) {
      // A torn file must never cost the game: fall back to the previous good
      // record, which save() keeps as .bak, and say so loudly.
      const backup = await this.readRecord(`${path}.bak`).catch(() => undefined);
      console.error(`room ${code}: ${path} is unreadable (${(error as Error).message}); ${backup ? "using the .bak copy" : "no .bak available"}`);
      if (backup) return backup;
      throw error;
    }
  }

  async save(record: GameRecord): Promise<void> {
    const previous = this.chains.get(record.code) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeNow(record));
    this.chains.set(record.code, next);
    try {
      await next;
    } finally {
      if (this.chains.get(record.code) === next) this.chains.delete(record.code);
    }
  }

  private async writeNow(record: GameRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(record.code);
    // Unique temp file per write (pid + sequence), written fully, then
    // renamed into place atomically; the last good file survives as .bak.
    const tmp = `${path}.${process.pid}.${this.writeSeq++}.tmp`;
    await writeFile(tmp, JSON.stringify(record), "utf8");
    await rename(path, `${path}.bak`).catch(() => undefined);
    await rename(tmp, path);
  }

  async delete(code: string): Promise<void> {
    const path = this.pathFor(code);
    await rm(path, { force: true });
    await rm(`${path}.bak`, { force: true });
  }

  async list(): Promise<string[]> {
    try {
      const names = await readdir(this.dir);
      return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
