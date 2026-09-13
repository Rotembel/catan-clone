import { describe, expect, it } from "vitest";
import { createRng, nextInt, rollDie, rollTwoDice, shuffle } from "../src/rng.js";

describe("seeded rng", () => {
  it("is deterministic: same seed -> same sequence", () => {
    let a = createRng("game-1");
    let b = createRng("game-1");
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 20; i++) {
      const ra = nextInt(a, 1000);
      const rb = nextInt(b, 1000);
      seqA.push(ra.value);
      seqB.push(rb.value);
      a = ra.state;
      b = rb.state;
    }
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    let a = createRng("seed-a");
    let b = createRng("seed-b");
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 10; i++) {
      const ra = nextInt(a, 1_000_000);
      const rb = nextInt(b, 1_000_000);
      seqA.push(ra.value);
      seqB.push(rb.value);
      a = ra.state;
      b = rb.state;
    }
    expect(seqA).not.toEqual(seqB);
  });

  it("rollDie stays within 1-6 over many rolls", () => {
    let state = createRng(42);
    for (let i = 0; i < 500; i++) {
      const { value, state: next } = rollDie(state);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      state = next;
    }
  });

  it("rollTwoDice produces a plausible dice-sum distribution (7 most common)", () => {
    let state = createRng("dice-distribution");
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const { dice, state: next } = rollTwoDice(state);
      const sum = dice[0] + dice[1];
      counts.set(sum, (counts.get(sum) ?? 0) + 1);
      state = next;
    }
    const sevenCount = counts.get(7) ?? 0;
    const twoCount = counts.get(2) ?? 0;
    // 7 has 6/36 odds, 2 has 1/36 — 7 should show up roughly 6x as often.
    expect(sevenCount).toBeGreaterThan(twoCount * 2);
  });

  it("shuffle is a permutation and is deterministic per seed", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const stateStart = createRng("shuffle-seed");
    const { result: r1 } = shuffle(items, stateStart);
    const { result: r2 } = shuffle(items, stateStart);
    expect(r1).toEqual(r2);
    expect([...r1].sort((a, b) => a - b)).toEqual(items);
  });
});
