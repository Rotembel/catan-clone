// mapgen-v1: the smallest useful balance layer over the seeded board
// generator (docs/planning/MAP_GENERATOR_DESIGN.md, trimmed to what Home
// Stable needs). Deterministic: candidate i is generateBaseBoardLayout
// seeded from `${seed}|${MAPGEN_VERSION}|${i}`; each is scored by a pure
// evaluator; the best (ties → lowest index) wins. Same seed + same version
// → same board, always. Geometry is untouched — the output is a normal
// BoardLayout the engine already understands.

import { buildBoardGeometry, createRng, type BoardGeometry } from "@catan/engine";
import type { BoardLayout, MapGenInfo, Resource, VertexId } from "@catan/shared";
import { generateBaseBoardLayout } from "./board.js";

export const MAPGEN_VERSION = "mapgen-v1";

/** 2d6 production weight of a number token. */
export const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

export interface MapGenConfig {
  seed: string;
  radius: number;
  /** Candidates to draw and score. */
  candidates?: number;
  seats: number;
  placementsPerSeat: number;
  /** Reject boards with two 6/8 tokens on touching hexes. */
  forbidAdjacentHighNumbers?: boolean;
  /** Penalise same-resource clusters above this size. */
  maxSameResourceCluster?: number;
  /** A vertex counts as a viable opening spot from this many pips. */
  minStartPips?: number;
}

export interface BoardBalanceScore {
  total: number;
  highNumberSeparation: number;
  resourceDiversity: number;
  startSpotFairness: number;
  productionSpread: number;
  /** Viable, mutually distance-rule-compatible opening spots found. */
  viableStartSpots: number;
  penalties: string[];
  rejected: boolean;
}

export interface MapGenResult {
  layout: BoardLayout;
  info: MapGenInfo;
  score: BoardBalanceScore;
}

const DEFAULTS = {
  candidates: 250,
  forbidAdjacentHighNumbers: true,
  maxSameResourceCluster: 3,
  minStartPips: 8,
};

function neighbourHexes(layout: BoardLayout, geometry: BoardGeometry): Map<string, string[]> {
  // Two hexes are neighbours when they share an edge.
  const out = new Map<string, string[]>();
  for (const h of layout.hexes) out.set(h.id, []);
  for (const hexes of geometry.edgeHexes.values()) {
    if (hexes.length !== 2) continue;
    const [a, b] = hexes as [string, string];
    out.get(a)!.push(b);
    out.get(b)!.push(a);
  }
  return out;
}

/** Sum of pips of the producing hexes around each vertex. */
export function vertexPips(layout: BoardLayout, geometry: BoardGeometry): Map<VertexId, number> {
  const byId = new Map(layout.hexes.map((h) => [h.id, h]));
  const out = new Map<VertexId, number>();
  for (const [vertex, hexIds] of geometry.vertexHexes) {
    let pips = 0;
    for (const id of hexIds) {
      const hex = byId.get(id);
      if (hex?.numberToken) pips += PIPS[hex.numberToken] ?? 0;
    }
    out.set(vertex, pips);
  }
  return out;
}

/**
 * Greedy count of strong opening spots that could all be taken together
 * under the distance rule (best vertex first). A lower bound on how many
 * independent openings the board offers.
 */
export function viableStartSpots(layout: BoardLayout, geometry: BoardGeometry, minPips: number): number {
  const pips = vertexPips(layout, geometry);
  const ranked = [...pips.entries()].filter(([, p]) => p >= minPips).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const taken = new Set<VertexId>();
  let count = 0;
  for (const [vertex] of ranked) {
    if (taken.has(vertex)) continue;
    count++;
    taken.add(vertex);
    for (const n of geometry.vertexNeighbors.get(vertex) ?? []) taken.add(n);
  }
  return count;
}

export function evaluateBoard(layout: BoardLayout, config: MapGenConfig): BoardBalanceScore {
  const cfg = { ...DEFAULTS, ...config };
  const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
  const byId = new Map(layout.hexes.map((h) => [h.id, h]));
  const neighbours = neighbourHexes(layout, geometry);
  const penalties: string[] = [];
  let rejected = false;

  // 1. High-number separation: touching 6/8 pairs.
  let hotPairs = 0;
  for (const [id, ns] of neighbours) {
    const a = byId.get(id)!;
    if (a.numberToken !== 6 && a.numberToken !== 8) continue;
    for (const n of ns) {
      if (n < id) continue; // count each pair once
      const b = byId.get(n)!;
      if (b.numberToken === 6 || b.numberToken === 8) hotPairs++;
    }
  }
  const highNumberSeparation = Math.max(0, 20 - hotPairs * 10);
  if (hotPairs > 0) {
    penalties.push(`${hotPairs} touching 6/8 pair${hotPairs === 1 ? "" : "s"}`);
    if (cfg.forbidAdjacentHighNumbers) rejected = true;
  }

  // 2. Resource diversity: same-resource clusters (BFS over neighbours).
  const seen = new Set<string>();
  let worstCluster = 0;
  for (const h of layout.hexes) {
    if (seen.has(h.id) || h.resource === "desert") continue;
    let size = 0;
    const queue = [h.id];
    seen.add(h.id);
    while (queue.length) {
      const id = queue.pop()!;
      size++;
      for (const n of neighbours.get(id) ?? []) {
        if (!seen.has(n) && byId.get(n)!.resource === h.resource) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    worstCluster = Math.max(worstCluster, size);
  }
  const over = Math.max(0, worstCluster - cfg.maxSameResourceCluster);
  const resourceDiversity = Math.max(0, 20 - over * 8);
  if (over > 0) penalties.push(`a cluster of ${worstCluster} same-resource hexes`);

  // 3. Start-spot fairness: enough independent strong openings for everyone.
  const needed = cfg.seats * cfg.placementsPerSeat;
  const spots = viableStartSpots(layout, geometry, cfg.minStartPips);
  const startSpotFairness = Math.min(30, Math.round((30 * spots) / Math.max(1, needed * 1.5)));
  if (spots < needed) {
    penalties.push(`only ${spots} viable opening spots for ${needed} structures`);
    rejected = true;
  }

  // 4. Production spread: no resource may be starved of pips.
  const pipsByResource = new Map<Resource, number>();
  let totalPips = 0;
  for (const h of layout.hexes) {
    if (h.resource === "desert" || !h.numberToken) continue;
    const p = PIPS[h.numberToken] ?? 0;
    totalPips += p;
    pipsByResource.set(h.resource, (pipsByResource.get(h.resource) ?? 0) + p);
  }
  const shares = [...pipsByResource.values()].map((p) => p / Math.max(1, totalPips));
  const minShare = shares.length ? Math.min(...shares) : 0;
  const productionSpread = Math.round(Math.min(30, (minShare / 0.2) * 30));
  if (minShare < 0.12) penalties.push("one resource is starved of production");

  const total = highNumberSeparation + resourceDiversity + startSpotFairness + productionSpread;
  return { total, highNumberSeparation, resourceDiversity, startSpotFairness, productionSpread, viableStartSpots: spots, penalties, rejected };
}

const HOT = new Set([6, 8]);

/**
 * Deterministic repair: while two hot tokens (6/8) touch, swap one of them
 * with a non-hot token on a producing hex none of whose neighbours is hot.
 * Stable iteration order → same input, same output. With eight hot tokens
 * on a 37-hex board a random shuffle almost never separates them all, so
 * sampling alone would reject nearly every candidate; construction is the
 * honest fix and keeps the base generator untouched.
 */
export function separateHotNumbers(layout: BoardLayout): BoardLayout {
  const geometry = buildBoardGeometry(layout.hexes.map((h) => ({ q: h.q, r: h.r })));
  const neighbours = neighbourHexes(layout, geometry);
  const hexes = layout.hexes.map((h) => ({ ...h }));
  const byId = new Map(hexes.map((h) => [h.id, h]));
  const isHot = (id: string) => HOT.has(byId.get(id)!.numberToken ?? 0);
  const hotNeighbour = (id: string, ignoring?: string) =>
    (neighbours.get(id) ?? []).some((n) => n !== ignoring && isHot(n));

  for (let pass = 0; pass < 8; pass++) {
    let swapped = false;
    for (const hex of hexes) {
      if (!isHot(hex.id) || !hotNeighbour(hex.id)) continue;
      // A calm hex: producing, not hot, and with no hot neighbour once this
      // token lands there (the swap partner's own neighbourhood must also
      // stay calm relative to the hex it is leaving, which is trivially true).
      const target = hexes.find(
        (t) => t.id !== hex.id && t.numberToken !== null && !HOT.has(t.numberToken) && !hotNeighbour(t.id) && !(neighbours.get(t.id) ?? []).includes(hex.id)
      );
      if (!target) continue;
      const tmp = hex.numberToken;
      hex.numberToken = target.numberToken;
      target.numberToken = tmp;
      swapped = true;
    }
    if (!swapped) break;
  }
  return { ...layout, hexes };
}

/** Deterministic: same config + seed + MAPGEN_VERSION → same layout, always. */
export function generateBoard(config: MapGenConfig): MapGenResult {
  const candidates = config.candidates ?? DEFAULTS.candidates;
  let best: MapGenResult | undefined;
  let bestRejected: MapGenResult | undefined;

  for (let i = 0; i < candidates; i++) {
    const rng = createRng(`${config.seed}|${MAPGEN_VERSION}|${i}`);
    const raw = generateBaseBoardLayout(rng, config.radius).layout;
    const layout = (config.forbidAdjacentHighNumbers ?? DEFAULTS.forbidAdjacentHighNumbers) ? separateHotNumbers(raw) : raw;
    const score = evaluateBoard(layout, config);
    const result: MapGenResult = {
      layout,
      score,
      info: { seed: config.seed, generationVersion: MAPGEN_VERSION, candidateIndex: i, score: score.total },
    };
    if (score.rejected) {
      if (!bestRejected || score.total > bestRejected.score.total) bestRejected = result;
      continue;
    }
    if (!best || score.total > best.score.total) best = result;
  }

  // Every candidate failed a hard constraint: take the least bad rather than
  // no board at all (the score's `rejected` flag says so).
  return best ?? bestRejected!;
}
