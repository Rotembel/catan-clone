import { describe, expect, it } from "vitest";
import { buildBoardGeometry, buildDevDeck } from "@catan/engine";
import type { Resource } from "@catan/shared";
import { createBaseRuleSet } from "../src/base.js";

describe("the base rule set", () => {
  const { ruleSet } = createBaseRuleSet({ seed: "test" });

  it("has the standard 19-hex board with the standard resource mix", () => {
    expect(ruleSet.board.hexes).toHaveLength(19);
    const counts: Record<string, number> = {};
    for (const hex of ruleSet.board.hexes) {
      counts[hex.resource] = (counts[hex.resource] ?? 0) + 1;
    }
    expect(counts).toEqual({ wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3, desert: 1 });
  });

  it("puts a number token on every hex but the desert, in the standard multiset", () => {
    const tokens = ruleSet.board.hexes
      .filter((h) => h.resource !== "desert")
      .map((h) => h.numberToken!)
      .sort((a, b) => a - b);
    expect(tokens).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(ruleSet.board.hexes.find((h) => h.resource === "desert")!.numberToken).toBeNull();
    // No 7: that's the robber's roll, never a hex.
    expect(tokens).not.toContain(7);
  });

  it("has 9 ports on real board edges: 4 generic and one per resource", () => {
    const ports = ruleSet.board.ports;
    expect(ports).toHaveLength(9);
    expect(ports.filter((p) => p.resource === null)).toHaveLength(4);
    expect(ports.filter((p) => p.ratio === 3)).toHaveLength(4);
    expect(ports.filter((p) => p.ratio === 2)).toHaveLength(5);

    const resources = ports.map((p) => p.resource).filter((r): r is Resource => r !== null).sort();
    expect(resources).toEqual(["brick", "ore", "sheep", "wheat", "wood"]);

    // Every port vertex is a real vertex of this board, and no two ports
    // share one (a single building must not claim two ports).
    const geometry = buildBoardGeometry(ruleSet.board.hexes.map((h) => ({ q: h.q, r: h.r })));
    const seen = new Set<string>();
    for (const port of ports) {
      for (const vertex of port.vertexIds) {
        expect(geometry.vertexHexes.has(vertex)).toBe(true);
        expect(seen.has(vertex)).toBe(false);
        seen.add(vertex);
      }
    }
  });

  it("has the standard 25-card development deck", () => {
    const deck = buildDevDeck(ruleSet);
    expect(deck).toHaveLength(25);
    expect(deck.filter((id) => id === "knight")).toHaveLength(14);
    expect(deck.filter((id) => id === "victoryPoint")).toHaveLength(5);
    expect(deck.filter((id) => id === "roadBuilding")).toHaveLength(2);
    expect(deck.filter((id) => id === "yearOfPlenty")).toHaveLength(2);
    expect(deck.filter((id) => id === "monopoly")).toHaveLength(2);
  });

  it("targets 10 points and leaves dev-card trading off", () => {
    expect(ruleSet.victoryPoints).toBe(10);
    expect(ruleSet.houseRules.tradeDevCards).toBe(false);
  });

  it("is seeded: same seed, same board; different seed, different board", () => {
    const again = createBaseRuleSet({ seed: "test" }).ruleSet;
    expect(again.board).toEqual(ruleSet.board);

    const other = createBaseRuleSet({ seed: "other" }).ruleSet;
    expect(other.board.hexes).not.toEqual(ruleSet.board.hexes);
  });

  it("scales to a bigger map without code changes", () => {
    const big = createBaseRuleSet({ seed: "test", radius: 3 }).ruleSet;
    expect(big.board.hexes).toHaveLength(37); // 3r^2+3r+1
  });
});
