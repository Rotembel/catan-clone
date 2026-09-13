// Canonical vertex/edge ids, derived from hex geometry — the part SPEC.md §5
// calls out as "easy to get wrong": a corner shared by three hexes must get
// exactly one id, however many of those hexes actually exist on the board.
//
// Approach: three mutually-adjacent hexes A, B, C share exactly one corner.
// In cube coordinates, A + B + C is the same triple no matter which of the
// three you compute it from (by symmetry of "mutually adjacent"), so that
// sum *is* the corner's canonical id — no rounding, no floats, no need for
// all three hexes to actually be present on the board.
//
// The one thing that has to be right is *which* two of the six
// HEX_DIRECTIONS neighbor a given corner index. Rather than hand-picking
// that correspondence (and risking an off-by-one), it's derived once here
// from independent pixel geometry (pixel.ts) and asserted self-consistent.
// Edge ids follow the same idea, one level simpler: an edge is just the
// (sorted) pair of the two hexes on either side of it.

import { HEX_DIRECTIONS, cubeAdd, cubeNeighbor, hexKey, type CubeCoord } from "./coords.js";
import { distance, hexCenter, hexCornerPoint, midpoint, type Point } from "./pixel.js";
import type { EdgeId, HexId, VertexId } from "@catan/shared";

const ORIGIN: CubeCoord = { x: 0, y: 0, z: 0 };
const EPS = 1e-6;

/**
 * For each hex corner index (0-5), the two HEX_DIRECTIONS indices whose
 * neighbor hex also touches that corner. Derived, not memorized: a
 * neighbor's center sits at distance 1 (its own circumradius, unit size)
 * from a corner exactly when that corner is also one of the neighbor's own
 * corners.
 */
function deriveCornerNeighbors(): ReadonlyArray<readonly [number, number]> {
  const result: Array<[number, number]> = [];
  for (let i = 0; i < 6; i++) {
    const corner = hexCornerPoint(ORIGIN, i, 1);
    const touching: number[] = [];
    for (let d = 0; d < 6; d++) {
      const dir = HEX_DIRECTIONS[d];
      if (!dir) continue;
      const neighborCenter = hexCenter(dir, 1);
      if (Math.abs(distance(corner, neighborCenter) - 1) < EPS) {
        touching.push(d);
      }
    }
    if (touching.length !== 2) {
      throw new Error(
        `board geometry error: corner ${i} should touch exactly 2 neighbor hexes, found ${touching.length}`
      );
    }
    result.push([touching[0]!, touching[1]!]);
  }
  return result;
}

/**
 * For each edge index (between corner i and corner (i+1)%6), the single
 * HEX_DIRECTIONS index of the neighbor across that edge — the direction
 * shared by both corners' neighbor sets.
 */
function deriveEdgeDirections(cornerNeighbors: ReadonlyArray<readonly [number, number]>): readonly number[] {
  const result: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = cornerNeighbors[i]!;
    const b = cornerNeighbors[(i + 1) % 6]!;
    const shared = a.filter((d) => b.includes(d));
    if (shared.length !== 1) {
      throw new Error(
        `board geometry error: edge ${i} should have exactly 1 shared neighbor direction, found ${shared.length}`
      );
    }
    result.push(shared[0]!);
  }
  return result;
}

const CORNER_NEIGHBORS = deriveCornerNeighbors();
const EDGE_DIRECTIONS = deriveEdgeDirections(CORNER_NEIGHBORS);

/** Canonical id of hex `c`'s corner `i` (0-5) — identical for every hex that shares it. */
export function vertexIdOf(c: CubeCoord, i: number): VertexId {
  const [d1, d2] = CORNER_NEIGHBORS[i]!;
  const n1 = cubeNeighbor(c, d1);
  const n2 = cubeNeighbor(c, d2);
  const x = c.x + n1.x + n2.x;
  const y = c.y + n1.y + n2.y;
  const z = c.z + n1.z + n2.z;
  return `v:${x},${y},${z}`;
}

/** The 6 canonical vertex ids around hex `c`, in corner order (0-5). */
export function hexVertices(c: CubeCoord): VertexId[] {
  return [0, 1, 2, 3, 4, 5].map((i) => vertexIdOf(c, i));
}

/** Canonical id of the edge between hex `c` and its neighbor across direction `d`. */
export function edgeIdOfDirection(c: CubeCoord, d: number): EdgeId {
  const neighbor = cubeNeighbor(c, d);
  const [a, b] = [hexKey(c), hexKey(neighbor)].sort();
  return `e:${a}|${b}`;
}

/**
 * The 6 canonical edge ids around hex `c`, in corner order: edge `i`
 * connects hexVertices(c)[i] and hexVertices(c)[(i+1) % 6].
 */
export function hexEdges(c: CubeCoord): EdgeId[] {
  return EDGE_DIRECTIONS.map((d) => edgeIdOfDirection(c, d));
}

function parseHexKey(id: HexId): CubeCoord {
  const [x, y, z] = id.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
}

/**
 * Pixel position of a canonical vertex id. Works for the parse-back
 * direction of the same identity used by `vertexIdOf`: the id triple is
 * exactly 3x the centroid of its (up to 3) surrounding hexes, so dividing
 * by 3 and treating it as a (fractional) cube coordinate recovers the point.
 */
export function vertexPixel(id: VertexId, size = 1): Point {
  const raw = id.slice(2); // strip "v:"
  const [x, y, z] = raw.split(",").map(Number);
  return hexCenter({ x: x! / 3, y: y! / 3, z: z! / 3 }, size);
}

/** Pixel midpoint of a canonical edge id — the point halfway between its two hexes. */
export function edgeMidpoint(id: EdgeId, size = 1): Point {
  const raw = id.slice(2); // strip "e:"
  const [hexA, hexB] = raw.split("|");
  const a = hexCenter(parseHexKey(hexA!), size);
  const b = hexCenter(parseHexKey(hexB!), size);
  return midpoint(a, b);
}

// Exposed for tests that want to cross-check the derivation itself.
export const __internal = { CORNER_NEIGHBORS, EDGE_DIRECTIONS, cubeAdd };
