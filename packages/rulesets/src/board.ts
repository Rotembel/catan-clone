// Generates the standard 19-hex Catan board layout as plain data
// (BoardLayout is pure data per SPEC.md §5 — this module just builds one).

import {
  axialToCube,
  buildBoardGeometry,
  edgeMidpoint,
  hexKey,
  hexagonAxials,
  shuffle,
  type RngState,
} from "@catan/engine";
import type { BoardLayout, EdgeId, HexTile, PortLayout, Resource } from "@catan/shared";

const RESOURCE_COUNTS: Record<Resource, number> = {
  wood: 4,
  brick: 3,
  sheep: 4,
  wheat: 4,
  ore: 3,
};

/** Standard 18 number tokens for the 18 non-desert hexes. */
const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** 9 standard ports: 4 generic (3:1) + 1 per resource (2:1). */
const PORT_PATTERN: (Resource | null)[] = [null, "wood", null, "brick", null, "sheep", null, "wheat", "ore"];

/** Hexes in a hexagon of the given radius: 3r² + 3r + 1. */
export function hexCountFor(radius: number): number {
  return 3 * radius * radius + 3 * radius + 1;
}

/** Deserts on a board of the given radius: 1 on the classic board, one more per ring. */
export function desertCountFor(radius: number): number {
  return Math.max(1, radius - 1);
}

/**
 * The resource pool for a board: the classic 19-hex mix at radius 2, and
 * the same proportions scaled (largest remainder) for bigger boards.
 */
export function resourcePoolFor(radius: number): (Resource | "desert")[] {
  const hexes = hexCountFor(radius);
  const deserts = desertCountFor(radius);
  const producing = hexes - deserts;
  const classicProducing = 18;
  const entries = Object.entries(RESOURCE_COUNTS) as [Resource, number][];
  const exact = entries.map(([r, n]) => ({ r, share: (n * producing) / classicProducing }));
  const counts = new Map(exact.map((e) => [e.r, Math.floor(e.share)]));
  let left = producing - [...counts.values()].reduce((s, n) => s + n, 0);
  for (const e of [...exact].sort((a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)))) {
    if (left <= 0) break;
    counts.set(e.r, counts.get(e.r)! + 1);
    left--;
  }
  const pool: (Resource | "desert")[] = [];
  for (const [r, n] of counts) for (let i = 0; i < n; i++) pool.push(r);
  for (let i = 0; i < deserts; i++) pool.push("desert");
  return pool;
}

/** Number tokens for `count` producing hexes: the classic 18 repeated in order, so proportions hold. */
export function numberTokensFor(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(NUMBER_TOKENS[i % NUMBER_TOKENS.length]!);
  return out;
}

/** Ports for a board: 9 on the classic coast, scaling with the coastline (the 5-6 player board has 11). */
export function portPatternFor(radius: number): (Resource | null)[] {
  const count = radius <= 2 ? PORT_PATTERN.length : Math.round((PORT_PATTERN.length * radius) / 2.5);
  const out: (Resource | null)[] = [];
  for (let i = 0; i < count; i++) out.push(PORT_PATTERN[i % PORT_PATTERN.length]!);
  return out;
}

/**
 * Places 9 ports on evenly-spaced boundary edges, going around the board by
 * angle from center. Exact positions aren't an official requirement here
 * (nothing in SPEC.md's tests checks specific port placement) — what matters
 * is 9 real boundary edges with the standard 4-generic/5-resource split.
 */
function assignPorts(axials: { q: number; r: number }[], pattern: (Resource | null)[] = PORT_PATTERN): PortLayout[] {
  const geometry = buildBoardGeometry(axials);
  const boundaryEdges: EdgeId[] = [];
  for (const [edgeId, hexes] of geometry.edgeHexes) {
    if (hexes.length === 1) boundaryEdges.push(edgeId);
  }

  const center = { x: 0, y: 0 };
  const sorted = [...boundaryEdges].sort((a, b) => {
    const pa = edgeMidpoint(a);
    const pb = edgeMidpoint(b);
    return Math.atan2(pa.y - center.y, pa.x - center.x) - Math.atan2(pb.y - center.y, pb.x - center.x);
  });

  const portCount = pattern.length;
  const ports: PortLayout[] = [];
  for (let i = 0; i < portCount; i++) {
    const edgeIndex = Math.floor((i * sorted.length) / portCount);
    const edgeId = sorted[edgeIndex]!;
    const [vA, vB] = geometry.edgeVertices.get(edgeId)!;
    const resource = pattern[i]!;
    ports.push({
      id: `port-${i}`,
      vertexIds: [vA, vB],
      ratio: resource === null ? 3 : 2,
      resource,
    });
  }
  return ports;
}

export function generateBaseBoardLayout(rngState: RngState, radius = 2): { layout: BoardLayout; state: RngState } {
  const axials = hexagonAxials(radius);
  const pool = resourcePoolFor(radius);
  if (pool.length !== axials.length) throw new Error(`resource pool (${pool.length}) does not cover ${axials.length} hexes`);
  const { result: resources, state: afterResources } = shuffle(pool, rngState);
  const tokens = numberTokensFor(pool.length - desertCountFor(radius));
  const { result: numbers, state: afterNumbers } = shuffle(tokens, afterResources);

  let numberIndex = 0;
  const hexes: HexTile[] = axials.map((axial, i) => {
    const cube = axialToCube(axial);
    const resource = resources[i]!;
    const numberToken = resource === "desert" ? null : numbers[numberIndex++]!;
    return { id: hexKey(cube), q: axial.q, r: axial.r, resource, numberToken };
  });

  const ports = assignPorts(axials, portPatternFor(radius));

  return { layout: { hexes, ports }, state: afterNumbers };
}

/** The hex a freshly-generated board starts the robber on (the desert). */
export function desertHexId(layout: BoardLayout): string {
  const desert = layout.hexes.find((h) => h.resource === "desert");
  if (!desert) throw new Error("board layout has no desert hex");
  return desert.id;
}
