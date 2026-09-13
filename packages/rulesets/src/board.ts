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

function baseResourcePool(): (Resource | "desert")[] {
  const pool: (Resource | "desert")[] = [];
  for (const [resource, count] of Object.entries(RESOURCE_COUNTS) as [Resource, number][]) {
    for (let i = 0; i < count; i++) pool.push(resource);
  }
  pool.push("desert");
  return pool;
}

/**
 * Places 9 ports on evenly-spaced boundary edges, going around the board by
 * angle from center. Exact positions aren't an official requirement here
 * (nothing in SPEC.md's tests checks specific port placement) — what matters
 * is 9 real boundary edges with the standard 4-generic/5-resource split.
 */
function assignPorts(axials: { q: number; r: number }[]): PortLayout[] {
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

  const portCount = PORT_PATTERN.length;
  const ports: PortLayout[] = [];
  for (let i = 0; i < portCount; i++) {
    const edgeIndex = Math.floor((i * sorted.length) / portCount);
    const edgeId = sorted[edgeIndex]!;
    const [vA, vB] = geometry.edgeVertices.get(edgeId)!;
    const resource = PORT_PATTERN[i]!;
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
  const { result: resources, state: afterResources } = shuffle(baseResourcePool(), rngState);
  const { result: numbers, state: afterNumbers } = shuffle(NUMBER_TOKENS, afterResources);

  let numberIndex = 0;
  const hexes: HexTile[] = axials.map((axial, i) => {
    const cube = axialToCube(axial);
    const resource = resources[i]!;
    const numberToken = resource === "desert" ? null : numbers[numberIndex++]!;
    return { id: hexKey(cube), q: axial.q, r: axial.r, resource, numberToken };
  });

  const ports = assignPorts(axials);

  return { layout: { hexes, ports }, state: afterNumbers };
}

/** The hex a freshly-generated board starts the robber on (the desert). */
export function desertHexId(layout: BoardLayout): string {
  const desert = layout.hexes.find((h) => h.resource === "desert");
  if (!desert) throw new Error("board layout has no desert hex");
  return desert.id;
}
