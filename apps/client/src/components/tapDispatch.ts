// What a tap on a board target should send. Pure, so the client's
// target-mode → action mapping can be unit-tested without React.
//
// Every branch re-derives legality from the *current* legal-action list —
// never from a set captured when the mode was entered — so a target that
// stopped being legal (new server state, someone else moved) can't submit.

import type { Action, EdgeId, VertexId } from "@catan/shared";

/** The subset of Game's Mode that resolves to a single action on a tap. */
export type VertexTapMode =
  | { kind: "idle" }
  | { kind: "buildKnight" }
  | { kind: "moveKnight"; from: VertexId }
  | { kind: "respondVertex" }
  | { kind: "progressVertex"; cardId: string }
  | { kind: string };

export type EdgeTapMode =
  | { kind: "idle" }
  | { kind: "respondEdge" }
  | { kind: "progressEdge"; cardId: string }
  | { kind: string };

/** Idle-mode vertex actions in priority order (a vertex may be legal for several). */
const IDLE_VERTEX_ORDER: Action["type"][] = ["placeMetropolis", "downgradeCity", "buildWall", "buildCity", "buildSettlement"];

function vertexLegal(legal: Action[], type: Action["type"], vertex: VertexId): boolean {
  return legal.some((a) => a.type === type && "vertex" in a && a.vertex === vertex);
}

export function vertexTapAction(mode: VertexTapMode, legal: Action[], vertex: VertexId): Action | undefined {
  switch (mode.kind) {
    case "buildKnight":
      return vertexLegal(legal, "buildKnight", vertex) ? { type: "buildKnight", vertex } : undefined;
    case "moveKnight": {
      const from = (mode as { from: VertexId }).from;
      // Covers displacement too: the engine lists an occupied `to` when the knight may displace.
      const ok = legal.some((a) => a.type === "moveKnight" && a.from === from && a.to === vertex);
      return ok ? { type: "moveKnight", from, to: vertex } : undefined;
    }
    case "respondVertex": {
      const ok = legal.some((a) => a.type === "respondInteraction" && (a.payload as { vertex?: VertexId } | undefined)?.vertex === vertex);
      return ok ? { type: "respondInteraction", payload: { vertex } } : undefined;
    }
    case "progressVertex": {
      const cardId = (mode as { cardId: string }).cardId;
      const ok = legal.some((a) => a.type === "playProgressCard" && a.cardId === cardId && (a.payload as { vertex?: VertexId } | undefined)?.vertex === vertex);
      return ok ? { type: "playProgressCard", cardId, payload: { vertex } } : undefined;
    }
    case "idle":
      for (const type of IDLE_VERTEX_ORDER) {
        if (vertexLegal(legal, type, vertex)) return { type, vertex } as Action;
      }
      return undefined;
    default:
      return undefined;
  }
}

export function edgeTapAction(mode: EdgeTapMode, legal: Action[], edge: EdgeId): Action | undefined {
  switch (mode.kind) {
    case "respondEdge": {
      const ok = legal.some((a) => a.type === "respondInteraction" && (a.payload as { edge?: EdgeId } | undefined)?.edge === edge);
      return ok ? { type: "respondInteraction", payload: { edge } } : undefined;
    }
    case "progressEdge": {
      const cardId = (mode as { cardId: string }).cardId;
      const ok = legal.some((a) => a.type === "playProgressCard" && a.cardId === cardId && (a.payload as { edge?: EdgeId } | undefined)?.edge === edge);
      return ok ? { type: "playProgressCard", cardId, payload: { edge } } : undefined;
    }
    case "idle":
      return legal.some((a) => a.type === "buildRoad" && a.edge === edge) ? { type: "buildRoad", edge } : undefined;
    default:
      return undefined;
  }
}
