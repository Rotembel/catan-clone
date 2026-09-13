// Independent geometric (pixel-space) math for hex centers/corners.
//
// This exists for two reasons: eventually rendering needs it, and — more
// importantly for Phase 0 — geometry.ts uses it once at module load to
// *derive* which neighbor hexes share each corner/edge, instead of that
// correspondence being hand-picked and possibly wrong. board.test.ts also
// uses it directly as an independent cross-check on the canonical ids.

import type { CubeCoord } from "./coords.js";
import { cubeToAxial } from "./coords.js";

export interface Point {
  x: number;
  y: number;
}

/** Pixel center of a hex, pointy-top orientation, at the given size (circumradius). */
export function hexCenter(c: CubeCoord, size = 1): Point {
  const { q, r } = cubeToAxial(c);
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * (1.5 * r),
  };
}

/** Pixel position of hex corner `i` (0-5), pointy-top orientation. */
export function hexCornerPoint(c: CubeCoord, i: number, size = 1): Point {
  const center = hexCenter(c, size);
  const angleDeg = 60 * i - 30;
  const angleRad = (Math.PI / 180) * angleDeg;
  return {
    x: center.x + size * Math.cos(angleRad),
    y: center.y + size * Math.sin(angleRad),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
