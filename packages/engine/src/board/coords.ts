// Axial <-> cube hex coordinates and the six neighbor directions.
// Pointy-top hex orientation (SPEC.md §5: "hexes use axial coords (q, r)").
//
// HexId/VertexId/EdgeId come from @catan/shared — this file does not
// redeclare them (see CLAUDE.md "One type source").

import type { HexId } from "@catan/shared";

export interface AxialCoord {
  q: number;
  r: number;
}

export interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

export function axialToCube({ q, r }: AxialCoord): CubeCoord {
  const x = q;
  const z = r;
  const y = -x - z;
  return { x, y, z };
}

export function cubeToAxial({ x, z }: CubeCoord): AxialCoord {
  return { q: x, r: z };
}

export function cubeAdd(a: CubeCoord, b: CubeCoord): CubeCoord {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function cubeEquals(a: CubeCoord, b: CubeCoord): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Canonical string key for a hex — doubles as its `HexId`. */
export function hexKey(c: AxialCoord | CubeCoord): HexId {
  const cube = "x" in c ? c : axialToCube(c);
  return `${cube.x},${cube.y},${cube.z}`;
}

/**
 * The six neighbor directions of a hex, in a fixed cyclic order. Which
 * corner/edge index each direction lines up with is *derived*, not assumed
 * — see geometry.ts and board.test.ts.
 */
export const HEX_DIRECTIONS: readonly CubeCoord[] = [
  { x: 1, y: -1, z: 0 },
  { x: 1, y: 0, z: -1 },
  { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 },
  { x: -1, y: 0, z: 1 },
  { x: 0, y: -1, z: 1 },
];

export function cubeNeighbor(c: CubeCoord, direction: number): CubeCoord {
  const dir = HEX_DIRECTIONS[direction];
  if (!dir) throw new Error(`invalid hex direction: ${direction}`);
  return cubeAdd(c, dir);
}

/** All (q, r) axial coords of a hexagon-shaped board of the given radius (1 = 7 hexes, 2 = 19, ...). */
export function hexagonAxials(radius: number): AxialCoord[] {
  const coords: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }
  return coords;
}
