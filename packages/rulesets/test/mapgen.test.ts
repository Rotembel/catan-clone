import { describe, expect, it } from "vitest";
import { buildBoardGeometry } from "@catan/engine";
import type { BoardLayout } from "@catan/shared";
import { desertCountFor, generateBaseBoardLayout, hexCountFor, resourcePoolFor } from "../src/board.js";
import { MAPGEN_VERSION, evaluateBoard, generateBoard, viableStartSpots } from "../src/mapgen.js";
import { createRng } from "@catan/engine";

const CONFIG = { seed: "wifi-night", radius: 3, seats: 5, placementsPerSeat: 3, candidates: 60 };

describe("radius-scaled base generator", () => {
  it("fills every hex on a 37-hex board with a real resource and token (the old pool stopped at 19)", () => {
    const { layout } = generateBaseBoardLayout(createRng("r3"), 3);
    expect(layout.hexes).toHaveLength(37);
    for (const h of layout.hexes) {
      expect(["wood", "brick", "sheep", "wheat", "ore", "desert"]).toContain(h.resource);
      if (h.resource === "desert") expect(h.numberToken).toBeNull();
      else expect(h.numberToken).toBeGreaterThanOrEqual(2);
    }
    expect(layout.hexes.filter((h) => h.resource === "desert")).toHaveLength(desertCountFor(3));
    expect(layout.ports.length).toBeGreaterThan(9);
  });

  it("keeps the classic 19-hex mix exactly at radius 2", () => {
    const pool = resourcePoolFor(2);
    const count = (r: string) => pool.filter((x) => x === r).length;
    expect([count("wood"), count("brick"), count("sheep"), count("wheat"), count("ore"), count("desert")]).toEqual([4, 3, 4, 4, 3, 1]);
    expect(hexCountFor(2)).toBe(19);
    expect(hexCountFor(3)).toBe(37);
  });
});

describe("mapgen-v1", () => {
  it("is deterministic: same seed + version → identical layout and metadata", () => {
    const a = generateBoard(CONFIG);
    const b = generateBoard(CONFIG);
    expect(a.layout).toEqual(b.layout);
    expect(a.info).toEqual(b.info);
    expect(a.info.generationVersion).toBe(MAPGEN_VERSION);
    expect(a.info.seed).toBe("wifi-night");
    expect(a.score.rejected).toBe(false);
  });

  it("different seeds give different boards", () => {
    const a = generateBoard(CONFIG);
    const b = generateBoard({ ...CONFIG, seed: "other" });
    expect(a.layout.hexes).not.toEqual(b.layout.hexes);
  });

  it("never places 6 next to 8 (or 6/6, 8/8) and leaves room for 15 opening structures", () => {
    const { layout, score } = generateBoard(CONFIG);
    const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
    const byId = new Map(layout.hexes.map((h) => [h.id, h]));
    for (const hexes of geometry.edgeHexes.values()) {
      if (hexes.length !== 2) continue;
      const [a, b] = hexes.map((id) => byId.get(id)!.numberToken) as [number | null, number | null];
      const hot = (n: number | null) => n === 6 || n === 8;
      expect(hot(a) && hot(b)).toBe(false);
    }
    expect(score.viableStartSpots).toBeGreaterThanOrEqual(15);
    expect(viableStartSpots(layout, geometry, 8)).toBe(score.viableStartSpots);
  });

  it("the evaluator rejects a hand-made 6/8 adjacency and flags clustering", () => {
    const { layout } = generateBoard(CONFIG);
    const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
    const pair = [...geometry.edgeHexes.values()].find((h) => h.length === 2)!;
    const bad: BoardLayout = {
      ...layout,
      hexes: layout.hexes.map((h) =>
        h.id === pair[0] ? { ...h, resource: "wood", numberToken: 6 } : h.id === pair[1] ? { ...h, resource: "wood", numberToken: 8 } : h
      ),
    };
    const score = evaluateBoard(bad, CONFIG);
    expect(score.rejected).toBe(true);
    expect(score.penalties.join(" ")).toMatch(/6\/8/);
    const ok = evaluateBoard(layout, CONFIG);
    expect(ok.total).toBeGreaterThan(score.total);
  });

  it("ports sit on real coastal edges of the generated board", () => {
    const { layout } = generateBoard(CONFIG);
    const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
    for (const port of layout.ports) {
      for (const v of port.vertexIds) expect(geometry.vertexHexes.has(v)).toBe(true);
    }
  });
});
