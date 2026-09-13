import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStore, type GameRecord } from "../src/store.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "catan-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function record(code: string, n: number): GameRecord {
  return { code, seats: [], createdAt: 1, updatedAt: n, game: undefined, ruleSet: undefined };
}

describe("FileStore", () => {
  it("survives a burst of overlapping saves: the file is whole and holds the last write", async () => {
    const store = new FileStore(dir);
    // Fire many saves without awaiting between them — what a room does when
    // bots move every few hundred ms while players join and leave.
    const writes = Array.from({ length: 60 }, (_, i) => store.save(record("BURST", i)));
    await Promise.all(writes);
    const raw = await readFile(join(dir, "BURST.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect((await store.load("BURST"))?.updatedAt).toBe(59);
  });

  it("falls back to the .bak copy when the main file is torn", async () => {
    const store = new FileStore(dir);
    await store.save(record("TORN", 1));
    await store.save(record("TORN", 2));
    // Simulate a torn write: trailing junk after valid JSON.
    const path = join(dir, "TORN.json");
    await writeFile(path, (await readFile(path, "utf8")) + "}}garbage", "utf8");
    const loaded = await store.load("TORN");
    expect(loaded?.updatedAt).toBe(1); // the previous good record
  });

  it("delete removes both the record and its backup", async () => {
    const store = new FileStore(dir);
    await store.save(record("GONE", 1));
    await store.save(record("GONE", 2));
    await store.delete("GONE");
    expect(await store.list()).toEqual([]);
    expect(await store.load("GONE")).toBeUndefined();
  });
});
