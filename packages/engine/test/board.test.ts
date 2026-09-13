// Board geometry tests — SPEC.md §5: "Write geometry unit tests before
// building on top of it." These are the safety net for the part of a
// Catan clone that's easiest to get subtly wrong: vertex/edge identity.

import { describe, expect, it } from "vitest";
import {
  axialToCube,
  cubeToAxial,
  cubeNeighbor,
  hexagonAxials,
  hexKey,
  buildBoardGeometry,
  hexVertices,
  hexEdges,
  type AxialCoord,
} from "../src/board/index.js";
import { hexCornerPoint, midpoint } from "../src/board/pixel.js";

/**
 * Rounds a pixel coordinate to a stable string key. `toFixed` alone is not
 * enough here: floating-point noise near zero (e.g. -1e-16) rounds to the
 * numeric value 0 but formats as the *string* "-0.0000", which would wrongly
 * disagree with "0.0000" as a map key despite being the same point.
 */
function pixelKey(p: { x: number; y: number }): string {
  const norm = (n: number) => {
    const rounded = Math.round(n * 1e4) / 1e4;
    return (rounded === 0 ? 0 : rounded).toFixed(4);
  };
  return `${norm(p.x)},${norm(p.y)}`;
}

describe("axial <-> cube coordinates", () => {
  it("round-trips through cube and back", () => {
    const samples: AxialCoord[] = [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -5, r: 4 },
      { q: 2, r: 2 },
    ];
    for (const axial of samples) {
      const cube = axialToCube(axial);
      expect(cube.x + cube.y + cube.z).toBe(0); // cube coords always sum to 0
      expect(cubeToAxial(cube)).toEqual(axial);
    }
  });
});

describe("two adjacent hexes", () => {
  it("share exactly 2 vertices and exactly 1 edge, for every direction", () => {
    const origin = axialToCube({ q: 0, r: 0 });
    for (let d = 0; d < 6; d++) {
      const neighbor = cubeNeighbor(origin, d);

      const originVerts = new Set(hexVertices(origin));
      const neighborVerts = new Set(hexVertices(neighbor));
      const sharedVerts = [...originVerts].filter((v) => neighborVerts.has(v));
      expect(sharedVerts).toHaveLength(2);

      const originEdges = new Set(hexEdges(origin));
      const neighborEdges = new Set(hexEdges(neighbor));
      const sharedEdges = [...originEdges].filter((e) => neighborEdges.has(e));
      expect(sharedEdges).toHaveLength(1);
    }
  });
});

describe("three mutually adjacent hexes", () => {
  it("agree on the single corner they all share", () => {
    // Two consecutive neighbor directions of a hex are always mutually
    // adjacent to each other too — that's the classic "3 hexes around a
    // point" triangle.
    const center = axialToCube({ q: 0, r: 0 });
    for (let d = 0; d < 6; d++) {
      const a = cubeNeighbor(center, d);
      const b = cubeNeighbor(center, (d + 1) % 6);

      const vCenter = new Set(hexVertices(center));
      const vA = new Set(hexVertices(a));
      const vB = new Set(hexVertices(b));

      const commonToAll = [...vCenter].filter((v) => vA.has(v) && vB.has(v));
      expect(commonToAll).toHaveLength(1);
    }
  });
});

describe("canonical ids vs. independent pixel geometry, on a 19-hex board", () => {
  const axials = hexagonAxials(2); // standard Catan-sized board
  const cubes = axials.map(axialToCube);

  it("groups corners into canonical vertex ids exactly when they share a pixel position", () => {
    type Corner = { hexId: string; i: number; vertexId: string; point: { x: number; y: number } };
    const corners: Corner[] = [];
    for (const c of cubes) {
      const verts = hexVertices(c);
      for (let i = 0; i < 6; i++) {
        corners.push({
          hexId: hexKey(c),
          i,
          vertexId: verts[i]!,
          point: hexCornerPoint(c, i, 1),
        });
      }
    }

    // Partition by canonical vertex id, and separately by rounded pixel
    // position. The two partitions must be identical: same id <=> same spot.
    const byVertexId = new Map<string, Set<string>>();
    const byPixel = new Map<string, Set<string>>();
    for (const corner of corners) {
      const pk = pixelKey(corner.point);
      if (!byVertexId.has(corner.vertexId)) byVertexId.set(corner.vertexId, new Set());
      byVertexId.get(corner.vertexId)!.add(pk);
      if (!byPixel.has(pk)) byPixel.set(pk, new Set());
      byPixel.get(pk)!.add(corner.vertexId);
    }

    for (const [vertexId, pixels] of byVertexId) {
      expect(pixels.size, `vertex ${vertexId} maps to more than one pixel position`).toBe(1);
    }
    for (const [pk, ids] of byPixel) {
      expect(ids.size, `pixel ${pk} was given more than one vertex id`).toBe(1);
    }

    // Independent count: unique pixel positions vs. unique canonical ids.
    expect(byVertexId.size).toBe(byPixel.size);
  });

  it("groups edges into canonical edge ids exactly when they share a pixel midpoint", () => {
    type EdgeSample = { edgeId: string; midpoint: { x: number; y: number } };
    const samples: EdgeSample[] = [];
    for (const c of cubes) {
      const verts = hexVertices(c);
      const edges = hexEdges(c);
      for (let i = 0; i < 6; i++) {
        const p1 = hexCornerPoint(c, i, 1);
        const p2 = hexCornerPoint(c, (i + 1) % 6, 1);
        samples.push({ edgeId: edges[i]!, midpoint: midpoint(p1, p2) });
      }
    }

    const byEdgeId = new Map<string, Set<string>>();
    const byPixel = new Map<string, Set<string>>();
    for (const s of samples) {
      const pk = pixelKey(s.midpoint);
      if (!byEdgeId.has(s.edgeId)) byEdgeId.set(s.edgeId, new Set());
      byEdgeId.get(s.edgeId)!.add(pk);
      if (!byPixel.has(pk)) byPixel.set(pk, new Set());
      byPixel.get(pk)!.add(s.edgeId);
    }

    for (const [edgeId, pixels] of byEdgeId) {
      expect(pixels.size, `edge ${edgeId} maps to more than one pixel midpoint`).toBe(1);
    }
    for (const [pk, ids] of byPixel) {
      expect(ids.size, `midpoint ${pk} was given more than one edge id`).toBe(1);
    }

    expect(byEdgeId.size).toBe(byPixel.size);
  });
});

describe("buildBoardGeometry on a 19-hex board", () => {
  const geometry = buildBoardGeometry(hexagonAxials(2));

  it("has plausible, self-consistent vertex/edge/hex counts", () => {
    expect(geometry.hexes.size).toBe(19);

    // Euler's formula for a planar graph with 19 bounded hex faces + 1 outer
    // face: V - E + F = 2, F = 20  =>  E = V + 18.
    const V = geometry.vertexHexes.size;
    const E = geometry.edgeHexes.size;
    expect(E).toBe(V + 18);

    // Every vertex touches 1-3 hexes, every edge touches 1-2.
    for (const hexes of geometry.vertexHexes.values()) {
      expect(hexes.length).toBeGreaterThanOrEqual(1);
      expect(hexes.length).toBeLessThanOrEqual(3);
    }
    for (const hexes of geometry.edgeHexes.values()) {
      expect(hexes.length).toBeGreaterThanOrEqual(1);
      expect(hexes.length).toBeLessThanOrEqual(2);
    }

    // Dedup actually happened: far fewer than the naive 19*6 unshared corners/edges.
    expect(V).toBeLessThan(19 * 6);
    expect(E).toBeLessThan(19 * 6);
  });

  it("keeps vertexNeighbors and vertexEdges in lockstep (no duplicate/missing edges)", () => {
    for (const [vertex, neighbors] of geometry.vertexNeighbors) {
      const edges = geometry.vertexEdges.get(vertex) ?? [];
      expect(edges.length).toBe(neighbors.length);
      expect(neighbors.length).toBeGreaterThanOrEqual(2);
      expect(neighbors.length).toBeLessThanOrEqual(3);
    }
  });

  it("has edgeVertices consistent with vertexEdges (both directions agree)", () => {
    for (const [edgeId, [v1, v2]] of geometry.edgeVertices) {
      expect(geometry.vertexEdges.get(v1)).toContain(edgeId);
      expect(geometry.vertexEdges.get(v2)).toContain(edgeId);
    }
  });
});

describe("hexagonAxials", () => {
  it("produces 3r^2+3r+1 hexes with no duplicates", () => {
    for (const radius of [0, 1, 2, 3]) {
      const axials = hexagonAxials(radius);
      expect(axials).toHaveLength(3 * radius * radius + 3 * radius + 1);
      const keys = new Set(axials.map((a) => hexKey(axialToCube(a))));
      expect(keys.size).toBe(axials.length);
    }
  });
});
