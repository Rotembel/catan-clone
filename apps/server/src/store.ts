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
import type { GameState, RuleSet, Seat } from "@catan/shared";

export interface StoredSeat extends Seat {
  token: string;
}

export interface GameRecord {
  code: string;
  seats: StoredSeat[];
  ruleSet?: RuleSet;
  game?: GameState;
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
  constructor(private readonly dir: string) {}

  private pathFor(code: string): string {
    if (!SAFE_CODE.test(code)) throw new Error(`refusing to use room code as a file name: ${code}`);
    return join(this.dir, `${code}.json`);
  }

  async load(code: string): Promise<GameRecord | undefined> {
    try {
      const raw = await readFile(this.pathFor(code), "utf8");
      return JSON.parse(raw) as GameRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(record: GameRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(record.code);
    // Write-then-rename so a crash mid-write can't leave a torn file.
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record), "utf8");
    await rename(tmp, path);
  }

  async delete(code: string): Promise<void> {
    await rm(this.pathFor(code), { force: true });
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
