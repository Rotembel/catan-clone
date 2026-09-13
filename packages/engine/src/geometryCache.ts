import type { BoardLayout } from "@catan/shared";
import { buildBoardGeometry, type BoardGeometry } from "./board/adjacency.js";

// Adjacency is derived from the layout, so it stays out of GameState (which
// must remain plain serializable data). It's expensive enough to rebuild on
// every action that it's worth memoizing per layout object — a cache, not
// hidden state: same layout always yields the same geometry.
const cache = new WeakMap<BoardLayout, BoardGeometry>();

export function getGeometry(layout: BoardLayout): BoardGeometry {
  const hit = cache.get(layout);
  if (hit) return hit;
  const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
  cache.set(layout, geometry);
  return geometry;
}
