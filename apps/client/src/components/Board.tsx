// The board, as SVG. Purely a projection of GameState + RuleSet through the
// engine's geometry helpers, plus clickable targets for whatever the parent
// says is legal right now.

import { useMemo } from "react";
import {
  axialToCube,
  edgeMidpoint,
  getGeometry,
  hexCenter,
  hexCornerPoint,
  vertexPixel,
  type Point,
} from "@catan/engine";
import type { EdgeId, GameState, HexId, Resource, RuleSet, VertexId } from "@catan/shared";
import { PLAYER_COLORS } from "./colors.js";

const HEX = 46;

const RESOURCE_FILL: Record<Resource | "desert", string> = {
  wood: "#2f6b3a",
  brick: "#b8532f",
  sheep: "#8fbf5a",
  wheat: "#e3b93d",
  ore: "#7c8391",
  desert: "#d9c79a",
};

const RESOURCE_LABEL: Record<Resource | "desert", string> = {
  wood: "Wood",
  brick: "Brick",
  sheep: "Sheep",
  wheat: "Wheat",
  ore: "Ore",
  desert: "Desert",
};

/** Dice pips for a number token: 6 and 8 are five pips, 2 and 12 are one. */
function pips(n: number): number {
  return 6 - Math.abs(7 - n);
}

export interface BoardTargets {
  vertices: Set<VertexId>;
  edges: Set<EdgeId>;
  hexes: Set<HexId>;
  /** Edges already picked in a multi-step choice (Road Building). */
  selectedEdges: Set<EdgeId>;
}

export interface BoardProps {
  game: GameState;
  ruleSet: RuleSet;
  targets: BoardTargets;
  onVertex: (v: VertexId) => void;
  onEdge: (e: EdgeId) => void;
  onHex: (h: HexId) => void;
}

export function Board({ game, ruleSet, targets, onVertex, onEdge, onHex }: BoardProps) {
  const layout = ruleSet.board;
  const geometry = getGeometry(layout);

  const scene = useMemo(() => {
    const hexes = layout.hexes.map((h) => {
      const cube = axialToCube({ q: h.q, r: h.r });
      const center = hexCenter(cube, HEX);
      const corners = [0, 1, 2, 3, 4, 5].map((i) => hexCornerPoint(cube, i, HEX));
      return { hex: h, center, corners };
    });

    const all = hexes.flatMap((h) => h.corners);
    const pad = HEX * 1.4;
    const minX = Math.min(...all.map((p) => p.x)) - pad;
    const minY = Math.min(...all.map((p) => p.y)) - pad;
    const maxX = Math.max(...all.map((p) => p.x)) + pad;
    const maxY = Math.max(...all.map((p) => p.y)) + pad;

    const boardCenter: Point = {
      x: hexes.reduce((s, h) => s + h.center.x, 0) / hexes.length,
      y: hexes.reduce((s, h) => s + h.center.y, 0) / hexes.length,
    };

    const edges = [...geometry.edgeVertices.entries()].map(([id, [a, b]]) => ({
      id,
      a: vertexPixel(a, HEX),
      b: vertexPixel(b, HEX),
    }));

    const vertices = [...geometry.vertexHexes.keys()].map((id) => ({ id, p: vertexPixel(id, HEX) }));

    const ports = layout.ports.map((port) => {
      const [v1, v2] = port.vertexIds;
      const a = vertexPixel(v1, HEX);
      const b = vertexPixel(v2, HEX);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = mid.x - boardCenter.x;
      const dy = mid.y - boardCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      const out = { x: mid.x + (dx / len) * HEX * 0.75, y: mid.y + (dy / len) * HEX * 0.75 };
      return { port, a, b, out };
    });

    return { hexes, edges, vertices, ports, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` };
  }, [layout, geometry]);

  return (
    <svg className="board" viewBox={scene.viewBox} role="img" aria-label="game board">
      {/* hexes */}
      {scene.hexes.map(({ hex: layoutHex, center, corners }) => {
        // The Inventor may have moved this hex's number; the layout itself never changes.
        const hex = { ...layoutHex, numberToken: game.board.tokenOverrides[layoutHex.id] ?? layoutHex.numberToken };
        const clickable = targets.hexes.has(hex.id);
        const isRobber = game.board.robberHex === hex.id;
        return (
          <g
            key={hex.id}
            className={clickable ? "hex clickable" : "hex"}
            onClick={clickable ? () => onHex(hex.id) : undefined}
          >
            <polygon
              points={corners.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={RESOURCE_FILL[hex.resource]}
              stroke="#1f2430"
              strokeWidth={2}
            />
            <title>
              {RESOURCE_LABEL[hex.resource]}
              {hex.numberToken !== null ? ` ${hex.numberToken}` : ""}
            </title>
            {hex.numberToken !== null && (
              <g>
                <circle cx={center.x} cy={center.y} r={HEX * 0.32} fill="#f7f1df" stroke="#1f2430" />
                <text
                  x={center.x}
                  y={center.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={HEX * 0.36}
                  fontWeight={700}
                  fill={hex.numberToken === 6 || hex.numberToken === 8 ? "#c0392b" : "#1f2430"}
                >
                  {hex.numberToken}
                </text>
                <text
                  x={center.x}
                  y={center.y + HEX * 0.22}
                  textAnchor="middle"
                  fontSize={HEX * 0.14}
                  fill={hex.numberToken === 6 || hex.numberToken === 8 ? "#c0392b" : "#1f2430"}
                >
                  {"•".repeat(pips(hex.numberToken))}
                </text>
              </g>
            )}
            {isRobber && (
              <g>
                <circle cx={center.x + HEX * 0.42} cy={center.y - HEX * 0.42} r={HEX * 0.2} fill="#111" />
                <title>Robber</title>
              </g>
            )}
            {clickable && (
              <polygon
                points={corners.map((p) => `${p.x},${p.y}`).join(" ")}
                className="target-hex"
              />
            )}
          </g>
        );
      })}

      {/* ports */}
      {scene.ports.map(({ port, a, b, out }) => (
        <g key={port.id} className="port">
          <line x1={a.x} y1={a.y} x2={out.x} y2={out.y} stroke="#6b5533" strokeWidth={2} strokeDasharray="4 3" />
          <line x1={b.x} y1={b.y} x2={out.x} y2={out.y} stroke="#6b5533" strokeWidth={2} strokeDasharray="4 3" />
          <circle cx={out.x} cy={out.y} r={HEX * 0.3} fill="#f7f1df" stroke="#6b5533" strokeWidth={2} />
          <text x={out.x} y={out.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={HEX * 0.2} fontWeight={700} fill="#4a3a22">
            {port.ratio}:1
          </text>
          <text x={out.x} y={out.y + HEX * 0.24} textAnchor="middle" dominantBaseline="middle" fontSize={HEX * 0.14} fill="#4a3a22">
            {port.resource ? RESOURCE_LABEL[port.resource] : "any"}
          </text>
        </g>
      ))}

      {/* roads */}
      {scene.edges.map(({ id, a, b }) => {
        const owner = game.board.roads[id];
        if (owner === undefined) return null;
        return (
          <line
            key={id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={PLAYER_COLORS[owner] ?? "#000"}
            strokeWidth={HEX * 0.18}
            strokeLinecap="round"
          />
        );
      })}

      {/* edge targets */}
      {scene.edges.map(({ id, a, b }) => {
        const legal = targets.edges.has(id);
        const selected = targets.selectedEdges.has(id);
        if (!legal && !selected) return null;
        const m = edgeMidpoint(id, HEX);
        return (
          <g key={`t-${id}`} className="clickable" onClick={() => onEdge(id)}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={HEX * 0.5} />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={selected ? "target-edge selected" : "target-edge"}
              strokeWidth={HEX * 0.16}
              strokeLinecap="round"
            />
            <circle cx={m.x} cy={m.y} r={HEX * 0.1} className="target-dot" />
          </g>
        );
      })}

      {/* buildings */}
      {scene.vertices.map(({ id, p }) => {
        const b = game.board.buildings[id];
        if (!b) return null;
        const color = PLAYER_COLORS[b.playerId] ?? "#000";
        const s = HEX * 0.26;
        return b.kind === "city" ? (
          <g key={id}>
            <polygon
              points={`${p.x - s},${p.y + s * 0.8} ${p.x - s},${p.y - s * 0.2} ${p.x - s * 0.4},${p.y - s * 0.9} ${p.x + s * 0.1},${p.y - s * 0.2} ${p.x + s},${p.y - s * 0.2} ${p.x + s},${p.y + s * 0.8}`}
              fill={color}
              stroke="#1f2430"
              strokeWidth={2}
            />
            <title>City</title>
          </g>
        ) : (
          <g key={id}>
            <polygon
              points={`${p.x - s * 0.8},${p.y + s * 0.7} ${p.x - s * 0.8},${p.y - s * 0.1} ${p.x},${p.y - s * 0.8} ${p.x + s * 0.8},${p.y - s * 0.1} ${p.x + s * 0.8},${p.y + s * 0.7}`}
              fill={color}
              stroke="#1f2430"
              strokeWidth={2}
            />
            <title>Settlement</title>
          </g>
        );
      })}

      {/* merchant (Cities & Knights) */}
      {game.merchant && (() => {
        const h = scene.hexes.find((x) => x.hex.id === game.merchant!.hex);
        if (!h) return null;
        const color = PLAYER_COLORS[game.merchant.playerId] ?? "#000";
        return (
          <g key="merchant">
            <rect x={h.center.x - HEX * 0.42 - 9} y={h.center.y + HEX * 0.26} width={18} height={18} rx={3} fill={color} stroke="#1f2430" strokeWidth={2} />
            <text x={h.center.x - HEX * 0.42} y={h.center.y + HEX * 0.26 + 13} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">M</text>
            <title>{`Merchant (${game.players[game.merchant.playerId]?.name ?? "?"})`}</title>
          </g>
        );
      })()}

      {/* city walls and metropolises (Cities & Knights) */}
      {scene.vertices.map(({ id, p }) => {
        const wall = game.board.walls[id] !== undefined;
        const metro = Object.entries(game.metropolises).find(([, m]) => m?.vertex === id);
        if (!wall && !metro) return null;
        return (
          <g key={`cw-${id}`} pointerEvents="none">
            {wall && <circle cx={p.x} cy={p.y} r={HEX * 0.34} fill="none" stroke="#5b4a2b" strokeWidth={3} strokeDasharray="4 2" />}
            {metro && (
              <text x={p.x} y={p.y - HEX * 0.3} textAnchor="middle" fontSize={HEX * 0.3} fill="#f5c400" stroke="#1f2430" strokeWidth={0.5}>
                ★<title>{`${metro[0]} metropolis`}</title>
              </text>
            )}
          </g>
        );
      })}

      {/* knights (Cities & Knights) */}
      {scene.vertices.map(({ id, p }) => {
        const k = game.board.knights[id];
        if (!k) return null;
        const color = PLAYER_COLORS[k.playerId] ?? "#000";
        const r = HEX * 0.24;
        return (
          <g key={`k-${id}`} opacity={k.active ? 1 : 0.55}>
            <circle cx={p.x} cy={p.y} r={r} fill={color} stroke="#1f2430" strokeWidth={2} />
            <text x={p.x} y={p.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={r * 1.2} fontWeight={700} fill="#fff">
              {k.level}
            </text>
            <title>{`${k.active ? "Active" : "Inactive"} knight, level ${k.level}`}</title>
          </g>
        );
      })}

      {/* vertex targets */}
      {scene.vertices.map(({ id, p }) => {
        if (!targets.vertices.has(id)) return null;
        return (
          <circle
            key={`t-${id}`}
            cx={p.x}
            cy={p.y}
            r={HEX * 0.22}
            className="target-vertex clickable"
            onClick={() => onVertex(id)}
          />
        );
      })}
    </svg>
  );
}
