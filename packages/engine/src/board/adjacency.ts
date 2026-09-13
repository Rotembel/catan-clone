// Full vertex/edge adjacency for a set of hexes (a BoardLayout's hex list).
// This is what reducers will read from for the distance rule, road
// connectivity, and "which hexes does this vertex touch" (SPEC.md §5).

import type { EdgeId, HexId, VertexId } from "@catan/shared";
import { axialToCube, hexKey, type AxialCoord, type CubeCoord } from "./coords.js";
import { hexEdges, hexVertices } from "./geometry.js";

export interface BoardGeometry {
  /** Every hex in the board, keyed by its canonical HexId. */
  hexes: Map<HexId, CubeCoord>;
  /** Which hexes (that exist on this board) touch each vertex — 1, 2, or 3. */
  vertexHexes: Map<VertexId, HexId[]>;
  /** Vertices directly connected to each vertex by a single edge. */
  vertexNeighbors: Map<VertexId, VertexId[]>;
  /** Which edges touch each vertex. */
  vertexEdges: Map<VertexId, EdgeId[]>;
  /** The two vertices each edge connects. */
  edgeVertices: Map<EdgeId, [VertexId, VertexId]>;
  /** Which hexes (that exist on this board) touch each edge — 1 or 2. */
  edgeHexes: Map<EdgeId, HexId[]>;
}

function pushUnique<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(value)) existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Build full vertex/edge adjacency for a set of hexes. */
export function buildBoardGeometry(hexCoords: AxialCoord[]): BoardGeometry {
  const hexes = new Map<HexId, CubeCoord>();
  const vertexHexes = new Map<VertexId, HexId[]>();
  const vertexEdges = new Map<VertexId, EdgeId[]>();
  const edgeVertices = new Map<EdgeId, [VertexId, VertexId]>();
  const edgeHexes = new Map<EdgeId, HexId[]>();
  const vertexNeighborSets = new Map<VertexId, Set<VertexId>>();

  for (const axial of hexCoords) {
    const cube = axialToCube(axial);
    hexes.set(hexKey(cube), cube);
  }

  for (const [id, cube] of hexes) {
    const verts = hexVertices(cube);
    const edges = hexEdges(cube);

    for (const v of verts) {
      pushUnique(vertexHexes, v, id);
    }

    for (let i = 0; i < 6; i++) {
      const edgeId = edges[i]!;
      const v1 = verts[i]!;
      const v2 = verts[(i + 1) % 6]!;

      edgeVertices.set(edgeId, [v1, v2]);
      pushUnique(edgeHexes, edgeId, id);
      pushUnique(vertexEdges, v1, edgeId);
      pushUnique(vertexEdges, v2, edgeId);

      if (!vertexNeighborSets.has(v1)) vertexNeighborSets.set(v1, new Set());
      if (!vertexNeighborSets.has(v2)) vertexNeighborSets.set(v2, new Set());
      vertexNeighborSets.get(v1)!.add(v2);
      vertexNeighborSets.get(v2)!.add(v1);
    }
  }

  const vertexNeighbors = new Map<VertexId, VertexId[]>();
  for (const [v, set] of vertexNeighborSets) {
    vertexNeighbors.set(v, [...set]);
  }

  return { hexes, vertexHexes, vertexNeighbors, vertexEdges, edgeVertices, edgeHexes };
}
