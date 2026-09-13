// The game screen. Everything here is derived from the last GameState the
// server sent; the engine is only consulted for *hints* (what's legal), and
// every click becomes an intent sent to the server (SPEC.md §1).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  COMMODITIES,
  IMPROVEMENT_TRACKS,
  RESOURCES,
  commodityTradeRatioFor,
  discardCountFor,
  handSize,
  legalActions,
  legalRoadEdges,
  nextImprovementCost,
  totalVictoryPoints,
  tradeRatiosFor,
  tryApply,
} from "@catan/engine";
import type {
  Action,
  Card,
  CardCounts,
  EdgeId,
  GameState,
  HexId,
  ImprovementTrack,
  Resource,
  RuleSet,
  VertexId,
} from "@catan/shared";
import { ruleSetInfo } from "@catan/rulesets";
import { clearError, leaveRoom, sendAction, type NetState } from "../net.js";
import { Board, type BoardTargets } from "./Board.js";
import { PLAYER_COLORS } from "./colors.js";

const RESOURCE_ICON: Record<Resource, string> = {
  wood: "🌲",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};

const CARD_ICON: Record<Card, string> = {
  ...RESOURCE_ICON,
  cloth: "🧵",
  coin: "🪙",
  paper: "📜",
};

const TRACK_LABEL: Record<ImprovementTrack, string> = {
  trade: "Trade",
  politics: "Politics",
  science: "Science",
};

/** Which cards a hand can hold under this rule set. */
function cardsIn(ruleSet: RuleSet): readonly Card[] {
  return ruleSet.citiesAndKnights ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
}

function heldOf(player: GameState["players"][number], card: Card): number {
  return card in player.resources
    ? player.resources[card as Resource]
    : player.commodities[card as keyof typeof player.commodities];
}

function bankOf(game: GameState, card: Card): number {
  return card in game.bank ? game.bank[card as Resource] : game.commodityBank[card as keyof typeof game.commodityBank];
}

type Mode =
  | { kind: "idle" }
  /** The base-game Knight card: pick the robber's hex. */
  | { kind: "devKnight" }
  /** Cities & Knights knights. */
  | { kind: "buildKnight"; vertices: Set<VertexId> }
  | { kind: "knightMenu"; vertex: VertexId }
  | { kind: "moveKnight"; from: VertexId; targets: Set<VertexId> }
  /** Answering another player's card on the board. */
  | { kind: "respondVertex"; vertices: Set<VertexId>; decline: boolean }
  | { kind: "respondEdge"; edges: Set<EdgeId>; decline: boolean }
  | { kind: "roadBuilding"; edges: EdgeId[] }
  | { kind: "victim"; hex: HexId; victims: number[]; viaKnight: boolean }
  /** Progress cards that target the board: one hex (Bishop, Merchant), one vertex (Engineer, Medicine), two hexes (Inventor). */
  | { kind: "progressHex"; cardId: string; hexes: Set<HexId> }
  | { kind: "progressVertex"; cardId: string; vertices: Set<VertexId> }
  /** A card whose payload is an edge (Diplomat): pick it on the board. */
  | { kind: "progressEdge"; cardId: string; edges: Set<EdgeId> }
  | { kind: "inventor"; first?: HexId };

type Dialog =
  | "bank"
  | "trade"
  | "monopoly"
  | "yearOfPlenty"
  /** A progress card whose payload is picked from a list. */
  | { progress: string }
  | null;

interface Props {
  net: NetState;
  game: GameState;
  ruleSet: RuleSet;
  me: number;
}

export function Game({ net, game, ruleSet, me }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [dialog, setDialog] = useState<Dialog>(null);

  // A new state from the server invalidates any half-finished local choice.
  useEffect(() => {
    setMode({ kind: "idle" });
  }, [game]);

  const legal = useMemo(() => legalActions(game, ruleSet, me), [game, ruleSet, me]);
  const has = (type: Action["type"]) => legal.some((a) => a.type === type);
  const player = game.players.find((p) => p.id === me)!;
  const current = game.players[game.turn.current]!;
  const isMyTurn = current.id === me;
  const over = game.winner !== undefined;

  const settlementVertices = useMemo(
    () => new Set(legal.flatMap((a) => (a.type === "buildSettlement" ? [a.vertex] : []))),
    [legal]
  );
  const cityVertices = useMemo(
    () => new Set(legal.flatMap((a) => (a.type === "buildCity" ? [a.vertex] : []))),
    [legal]
  );
  const roadEdges = useMemo(
    () => new Set(legal.flatMap((a) => (a.type === "buildRoad" ? [a.edge] : []))),
    [legal]
  );
  const robberMoves = useMemo(() => groupByHex(legal, "moveRobber"), [legal]);
  const downgradeVertices = useMemo(
    () => new Set(legal.flatMap((a) => (a.type === "downgradeCity" ? [a.vertex] : []))),
    [legal]
  );
  const wallVertices = useMemo(() => new Set(legal.flatMap((a) => (a.type === "buildWall" ? [a.vertex] : []))), [legal]);
  const metropolisVertexSet = useMemo(() => new Set(legal.flatMap((a) => (a.type === "placeMetropolis" ? [a.vertex] : []))), [legal]);
  const knightMoves = useMemo(() => groupByHex(legal, "knight"), [legal]);

  // Cities & Knights knight pieces.
  const knightBuildVertices = useMemo(() => new Set(legal.flatMap((a) => (a.type === "buildKnight" ? [a.vertex] : []))), [legal]);
  const actableKnights = useMemo(() => new Set(legal.flatMap((a) => (a.type === "activateKnight" || a.type === "promoteKnight" ? [a.vertex] : a.type === "moveKnight" ? [a.from] : []))), [legal]);
  const knightMoveTargetsFrom = (from: VertexId) => new Set(legal.flatMap((a) => (a.type === "moveKnight" && a.from === from ? [a.to] : [])));
  // A response owed to someone's card.
  const responseOptions = useMemo(() => legal.flatMap((a) => (a.type === "respondInteraction" ? [a.payload] : [])), [legal]);
  const responseShape = useMemo(() => {
    if (responseOptions.length === 0) return null;
    const objs = responseOptions.map((o) => (o ?? {}) as Record<string, unknown>);
    const decline = objs.some((o) => Object.keys(o).length === 0);
    const vertices = objs.flatMap((o) => (typeof o.vertex === "string" ? [o.vertex as VertexId] : []));
    const edges = objs.flatMap((o) => (typeof o.edge === "string" ? [o.edge as EdgeId] : []));
    if (vertices.length > 0) return { kind: "vertex" as const, vertices: new Set(vertices), decline };
    if (edges.length > 0) return { kind: "edge" as const, edges: new Set(edges), decline };
    return { kind: "list" as const, decline };
  }, [responseOptions]);
  const mustRespond = game.turn.phase === "respond" && game.pendingInteraction?.currentResponder === me;
  const owesForcedDiscard = game.turn.phase === "forcedDiscard" && (game.discardRequests ?? []).some((r) => r.playerId === me);
  useEffect(() => {
    // A board-shaped response is entered automatically so the prompt is unmissable.
    if (mustRespond && responseShape?.kind === "vertex") setMode({ kind: "respondVertex", vertices: responseShape.vertices, decline: responseShape.decline });
    if (mustRespond && responseShape?.kind === "edge") setMode({ kind: "respondEdge", edges: responseShape.edges, decline: responseShape.decline });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mustRespond, responseShape]);

  const canPlay = (cardId: string) =>
    legal.some((a) => a.type === "playDevCard" && a.cardId === cardId);
  const progressPayloads = (cardId: string): unknown[] =>
    legal.flatMap((a) => (a.type === "playProgressCard" && a.cardId === cardId ? [a.payload] : []));
  const inventorHexes = useMemo(() => {
    const pairs = progressPayloads("inventor") as { hexA: HexId; hexB: HexId }[];
    return pairs;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legal]);

  /** Start playing a progress card: auto-send when there is no choice, else open the right picker. */
  const startProgressCard = (cardId: string) => {
    const payloads = progressPayloads(cardId);
    if (payloads.length === 0) return;
    if (cardId === "bishop" || cardId === "merchant") {
      setMode({ kind: "progressHex", cardId, hexes: new Set((payloads as { hex: HexId }[]).map((p) => p.hex)) });
      return;
    }
    if (cardId === "engineer" || cardId === "medicine") {
      setMode({ kind: "progressVertex", cardId, vertices: new Set((payloads as { vertex: VertexId }[]).map((p) => p.vertex)) });
      return;
    }
    if (cardId === "diplomat") {
      setMode({ kind: "progressEdge", cardId, edges: new Set((payloads as { edge: EdgeId }[]).map((p) => p.edge)) });
      return;
    }
    if (cardId === "inventor") {
      setMode({ kind: "inventor" });
      return;
    }
    if (payloads.length === 1) {
      sendAction({ type: "playProgressCard", cardId, payload: payloads[0] });
      return;
    }
    setDialog({ progress: cardId });
  };

  // Road Building: after the first pick, the second road may hang off it, so
  // ask the engine what's legal from that hypothetical state.
  const roadBuildingEdges = useMemo(() => {
    if (mode.kind !== "roadBuilding") return new Set<EdgeId>();
    if (mode.edges.length === 0) return new Set(legalRoadEdges(game, ruleSet, me));
    const probe = tryApply(
      game,
      { playerId: me, action: { type: "playDevCard", cardId: "roadBuilding", payload: { edges: mode.edges } } },
      ruleSet
    );
    if (!probe.ok) return new Set<EdgeId>();
    return new Set(legalRoadEdges(probe.state, ruleSet, me).filter((e) => !mode.edges.includes(e)));
  }, [mode, game, ruleSet, me]);

  const targets: BoardTargets = useMemo(() => {
    const none = { vertices: new Set<VertexId>(), edges: new Set<EdgeId>(), hexes: new Set<HexId>(), selectedEdges: new Set<EdgeId>() };
    if (over) return none;
    switch (mode.kind) {
      case "devKnight":
        return { ...none, hexes: new Set(knightMoves.keys()) };
      case "buildKnight":
        return { ...none, vertices: mode.vertices };
      case "knightMenu":
        return { ...none, knights: new Set([mode.vertex]) };
      case "moveKnight":
        return { ...none, vertices: mode.targets, knights: new Set([mode.from]) };
      case "respondVertex":
        return { ...none, vertices: mode.vertices };
      case "respondEdge":
        return { ...none, edges: mode.edges };
      case "progressHex":
        return { ...none, hexes: mode.hexes };
      case "progressVertex":
        return { ...none, vertices: mode.vertices };
      case "progressEdge":
        return { ...none, edges: mode.edges };
      case "inventor": {
        const hexes = new Set<HexId>();
        for (const p of inventorHexes) {
          if (!mode.first) {
            hexes.add(p.hexA);
            hexes.add(p.hexB);
          } else if (p.hexA === mode.first) hexes.add(p.hexB);
          else if (p.hexB === mode.first) hexes.add(p.hexA);
        }
        return { ...none, hexes };
      }
      case "roadBuilding":
        return { ...none, edges: roadBuildingEdges, selectedEdges: new Set(mode.edges) };
      case "victim":
        return none;
      case "idle":
        return {
          vertices: new Set([...settlementVertices, ...cityVertices, ...downgradeVertices, ...wallVertices, ...metropolisVertexSet]),
          edges: roadEdges,
          hexes: new Set(robberMoves.keys()),
          selectedEdges: new Set<EdgeId>(),
          knights: actableKnights,
        };
    }
  }, [mode, over, knightMoves, roadBuildingEdges, settlementVertices, cityVertices, roadEdges, robberMoves, downgradeVertices, inventorHexes, wallVertices, metropolisVertexSet, actableKnights]);

  const onKnight = (v: VertexId) => {
    if (mode.kind === "idle" && actableKnights.has(v)) setMode({ kind: "knightMenu", vertex: v });
  };

  const onVertex = (v: VertexId) => {
    if (mode.kind === "buildKnight") {
      if (mode.vertices.has(v)) sendAction({ type: "buildKnight", vertex: v });
      return;
    }
    if (mode.kind === "moveKnight") {
      if (mode.targets.has(v)) sendAction({ type: "moveKnight", from: mode.from, to: v });
      return;
    }
    if (mode.kind === "respondVertex") {
      if (mode.vertices.has(v)) sendAction({ type: "respondInteraction", payload: { vertex: v } });
      return;
    }
    if (mode.kind === "progressVertex") {
      if (mode.vertices.has(v)) sendAction({ type: "playProgressCard", cardId: mode.cardId, payload: { vertex: v } });
      return;
    }
    if (metropolisVertexSet.has(v)) sendAction({ type: "placeMetropolis", vertex: v });
    else if (downgradeVertices.has(v)) sendAction({ type: "downgradeCity", vertex: v });
    else if (wallVertices.has(v)) sendAction({ type: "buildWall", vertex: v });
    else if (cityVertices.has(v)) sendAction({ type: "buildCity", vertex: v });
    else if (settlementVertices.has(v)) sendAction({ type: "buildSettlement", vertex: v });
  };

  const onEdge = (e: EdgeId) => {
    if (mode.kind === "progressEdge") {
      if (mode.edges.has(e)) sendAction({ type: "playProgressCard", cardId: mode.cardId, payload: { edge: e } });
      return;
    }
    if (mode.kind === "respondEdge") {
      if (mode.edges.has(e)) sendAction({ type: "respondInteraction", payload: { edge: e } });
      return;
    }
    if (mode.kind === "roadBuilding") {
      if (mode.edges.includes(e)) {
        setMode({ kind: "roadBuilding", edges: mode.edges.filter((x) => x !== e) });
        return;
      }
      const edges = [...mode.edges, e];
      if (edges.length === 2) {
        sendAction({ type: "playDevCard", cardId: "roadBuilding", payload: { edges } });
      } else {
        setMode({ kind: "roadBuilding", edges });
      }
      return;
    }
    if (roadEdges.has(e)) sendAction({ type: "buildRoad", edge: e });
  };

  const moveRobberTo = (hex: HexId, victims: number[], viaKnight: boolean) => {
    const send = (stealFrom?: number) =>
      viaKnight
        ? sendAction({ type: "playDevCard", cardId: "knight", payload: { hex, stealFrom } })
        : sendAction({ type: "moveRobber", hex, stealFrom });
    if (victims.length <= 1) send(victims[0]);
    else setMode({ kind: "victim", hex, victims, viaKnight });
  };

  const onHex = (h: HexId) => {
    if (mode.kind === "progressHex") {
      if (mode.hexes.has(h)) sendAction({ type: "playProgressCard", cardId: mode.cardId, payload: { hex: h } });
      return;
    }
    if (mode.kind === "inventor") {
      if (!mode.first) {
        setMode({ kind: "inventor", first: h });
        return;
      }
      const pair = inventorHexes.find((p) => (p.hexA === mode.first && p.hexB === h) || (p.hexB === mode.first && p.hexA === h));
      if (pair) sendAction({ type: "playProgressCard", cardId: "inventor", payload: pair });
      return;
    }
    if (mode.kind === "devKnight") {
      const victims = knightMoves.get(h);
      if (victims) moveRobberTo(h, victims, true);
      return;
    }
    const victims = robberMoves.get(h);
    if (victims) moveRobberTo(h, victims, false);
  };

  const owesDiscard = (game.pendingDiscards ?? []).includes(me);
  const owesProgressDiscard = (game.pendingProgressDiscards ?? []).includes(me);
  const tradeForMe = game.pendingTrade?.toPlayerId === me ? game.pendingTrade : undefined;

  return (
    <div className="game">
      <header className="topbar">
        <div>
          <strong>Room {net.code}</strong>
          {ruleSet.id !== "base" && (
            <span className="tag" title={ruleSetInfo(ruleSet.id)?.description}>
              {ruleSetInfo(ruleSet.id)?.label ?? ruleSet.id}
            </span>
          )}
          {!net.connected && <span className="tag warn">reconnecting…</span>}
        </div>
        <div className="status">{statusText(game, ruleSet, me, mode)}</div>
        <button className="small" onClick={leaveRoom}>Leave</button>
      </header>

      <div className="layout">
        <div className="board-wrap">
          <Board game={game} ruleSet={ruleSet} targets={targets} onVertex={onVertex} onEdge={onEdge} onHex={onHex} onKnight={onKnight} />
          {ruleSet.citiesAndKnights && (
            <div className="ck-strip" data-testid="ck-strip">
              <span>⛵ barbarians <b>{game.barbarianPosition}</b>/{ruleSet.citiesAndKnights.barbarianTrackLength}</span>
              <span>🎲 event: {game.eventDie ? (game.eventDie === "barbarian" ? "barbarians" : `${game.eventDie} gate`) : "—"}</span>
              <span>▶ {current.name}{isMyTurn ? " (you)" : ""}</span>
              <span className="muted">knights: bright = active, number = strength</span>
            </div>
          )}
          {game.dice && (
            <div className="dice" aria-label="dice">
              <span>{game.dice[0]}</span>
              <span>{game.dice[1]}</span>
            </div>
          )}
        </div>

        <aside className="panel">
          <Players game={game} ruleSet={ruleSet} me={me} net={net} />

          <section className="hand">
            <h3>Your hand <span className="muted">({handSize(player)})</span></h3>
            <div className="resources">
              {RESOURCES.map((r) => (
                <span key={r} className="res" title={r}>
                  {RESOURCE_ICON[r]} {player.resources[r]}
                </span>
              ))}
            </div>
            {ruleSet.citiesAndKnights && (
              <p className="muted" data-testid="barbarians">
                Barbarians {game.barbarianPosition}/{ruleSet.citiesAndKnights.barbarianTrackLength}
                {game.eventDie ? ` · event die: ${game.eventDie === "barbarian" ? "⛵ barbarians" : `🏰 ${game.eventDie}`}` : ""}
                {" · "}your knights {Object.values(game.board.knights).filter((k) => k?.playerId === me).length}
                {" · walls "}{Object.values(game.board.walls).filter((o) => o === me).length}
                {Object.entries(game.metropolises).filter(([, m]) => m?.playerId === me).map(([t]) => ` · ${t} metropolis`).join("")}
                {game.merchant?.playerId === me ? " · merchant" : ""}
                {player.defenderOfCatan > 0 ? ` · Defender of Catan ×${player.defenderOfCatan}` : ""}
              </p>
            )}
            {ruleSet.citiesAndKnights && (
              <div className="resources" data-testid="commodities">
                {COMMODITIES.map((c) => (
                  <span key={c} className="res" title={c}>
                    {CARD_ICON[c]} {player.commodities[c]}
                  </span>
                ))}
              </div>
            )}
            {player.devCards.length > 0 && (
              <div className="devcards">
                {Object.entries(countBy(player.devCards)).map(([id, n]) => {
                  const def = ruleSet.devCards.find((d) => d.id === id);
                  const playable = canPlay(id) && mode.kind === "idle";
                  return (
                    <button
                      key={id}
                      className="devcard"
                      disabled={!playable}
                      title={def?.kind === "victoryPoint" ? "Counts toward victory, revealed when you win" : undefined}
                      onClick={() => {
                        if (id === "knight") setMode({ kind: "devKnight" });
                        else if (id === "roadBuilding") setMode({ kind: "roadBuilding", edges: [] });
                        else if (id === "monopoly") setDialog("monopoly");
                        else if (id === "yearOfPlenty") setDialog("yearOfPlenty");
                      }}
                    >
                      {def?.label ?? id} ×{n}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {ruleSet.citiesAndKnights && (
            <section className="progress" data-testid="progress-cards">
              <h3>Progress cards <span className="muted">({player.progressCards.length}/{ruleSet.citiesAndKnights.progressHandLimit}{player.progressVictoryPoints ? ` · +${player.progressVictoryPoints} VP` : ""})</span></h3>
              {player.progressCards.length === 0 ? (
                <p className="muted">None yet — city improvements earn them on the event die.</p>
              ) : (
                <div className="devcards">
                  {Object.entries(countBy(player.progressCards)).map(([id, n]) => {
                    const def = ruleSet.citiesAndKnights!.progressCards.find((d) => d.id === id);
                    const playable = mode.kind === "idle" && progressPayloads(id).length > 0;
                    return (
                      <button key={id} className="devcard" disabled={!playable} title={def ? `${def.category} · ${def.timing === "beforeRoll" ? "play before rolling" : "play on your turn"}` : id} onClick={() => startProgressCard(id)}>
                        {def?.label ?? id} ×{n}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {ruleSet.citiesAndKnights && (
            <section className="improvements" data-testid="improvements">
              <h3>City improvements</h3>
              {IMPROVEMENT_TRACKS.map((track) => {
                const level = player.improvements[track];
                const cost = nextImprovementCost(game, ruleSet, me, track);
                const commodity = ruleSet.citiesAndKnights!.trackCommodity[track];
                const can = legal.some((a) => a.type === "buildImprovement" && a.track === track) && mode.kind === "idle";
                return (
                  <div key={track} className="track">
                    <span>
                      {TRACK_LABEL[track]} <b>{level}</b>/{ruleSet.citiesAndKnights!.improvementCosts.length}
                    </span>
                    <button className="small" disabled={!can} onClick={() => sendAction({ type: "buildImprovement", track })}
                      title={cost === undefined ? "Maxed out" : `Next level costs ${cost} ${commodity}`}>
                      {cost === undefined ? "Max" : `Improve (${cost} ${CARD_ICON[commodity]})`}
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {!over && (
            <section className="actions">
              {mode.kind !== "idle" ? (
                <div className="row">
                  <span className="muted">
                    {mode.kind === "devKnight" && "Pick a hex for the robber."}
                    {mode.kind === "roadBuilding" && `Pick ${2 - mode.edges.length} more road${mode.edges.length === 1 ? "" : "s"}.`}
                    {mode.kind === "victim" && "Steal from:"}
                    {mode.kind === "buildKnight" && "Build a knight: pick an empty spot next to your road."}
                    {mode.kind === "moveKnight" && "Move the knight: pick a destination (a weaker enemy knight there is pushed away)."}
                    {mode.kind === "respondVertex" && `${responseTitle(game, ruleSet)} — pick on the board.`}
                    {mode.kind === "respondEdge" && `${responseTitle(game, ruleSet)} — pick an edge.`}
                    {mode.kind === "knightMenu" && `Knight (level ${game.board.knights[mode.vertex]?.level ?? "?"}, ${game.board.knights[mode.vertex]?.active ? "active" : "inactive"}):`}
                    {mode.kind === "progressHex" && (mode.cardId === "bishop" ? "Bishop: pick the robber's new hex." : "Merchant: pick a hex next to one of your buildings.")}
                    {mode.kind === "progressVertex" && (mode.cardId === "engineer" ? "Engineer: pick a city to wall." : "Medicine: pick a settlement to upgrade.")}
                    {mode.kind === "progressEdge" && "Diplomat: pick an open road to remove (your own may be re-placed)."}
                    {mode.kind === "inventor" && (mode.first ? "Inventor: pick the second hex to swap with." : "Inventor: pick the first hex.")}
                  </span>
                  {mode.kind === "victim" &&
                    mode.victims.map((v) => (
                      <button key={v} className="small" onClick={() => {
                        const { hex, viaKnight } = mode;
                        viaKnight
                          ? sendAction({ type: "playDevCard", cardId: "knight", payload: { hex, stealFrom: v } })
                          : sendAction({ type: "moveRobber", hex, stealFrom: v });
                      }}>
                        {game.players.find((p) => p.id === v)?.name}
                      </button>
                    ))}
                  {mode.kind === "knightMenu" && (
                    <>
                      {legal.some((a) => a.type === "activateKnight" && a.vertex === mode.vertex) && (
                        <button className="small primary" onClick={() => sendAction({ type: "activateKnight", vertex: mode.vertex })}>Activate ({CARD_ICON.wheat}1)</button>
                      )}
                      {legal.some((a) => a.type === "promoteKnight" && a.vertex === mode.vertex) && (
                        <button className="small" onClick={() => sendAction({ type: "promoteKnight", vertex: mode.vertex })}>Promote ({CARD_ICON.sheep}1 {CARD_ICON.ore}1)</button>
                      )}
                      {knightMoveTargetsFrom(mode.vertex).size > 0 && (
                        <button className="small" onClick={() => setMode({ kind: "moveKnight", from: mode.vertex, targets: knightMoveTargetsFrom(mode.vertex) })}>Move</button>
                      )}
                    </>
                  )}
                  {(mode.kind === "respondVertex" || mode.kind === "respondEdge") && mode.decline && (
                    <button className="small" onClick={() => sendAction({ type: "respondInteraction", payload: {} })}>Decline</button>
                  )}
                  {mode.kind === "roadBuilding" && mode.edges.length === 1 && roadBuildingEdges.size === 0 && (
                    <button className="small" onClick={() => sendAction({ type: "playDevCard", cardId: "roadBuilding", payload: { edges: mode.edges } })}>
                      Build just one
                    </button>
                  )}
                  {mode.kind !== "respondVertex" && mode.kind !== "respondEdge" && (
                    <button className="small" onClick={() => setMode({ kind: "idle" })}>Cancel</button>
                  )}
                </div>
              ) : (
                <div className="row wrap">
                  {has("rollDice") && (
                    <button className="primary" onClick={() => sendAction({ type: "rollDice" })}>Roll dice</button>
                  )}
                  {has("buyDevCard") && (
                    <button onClick={() => sendAction({ type: "buyDevCard" })}>Buy dev card</button>
                  )}
                  {knightBuildVertices.size > 0 && (
                    <button onClick={() => setMode({ kind: "buildKnight", vertices: knightBuildVertices })}>Build knight ({CARD_ICON.sheep}1 {CARD_ICON.ore}1)</button>
                  )}
                  {actableKnights.size > 0 && <span className="muted">Tap a highlighted knight to activate, promote or move it.</span>}
                  {isMyTurn && game.turn.phase === "mainTurn" && (
                    <>
                      <button onClick={() => setDialog("bank")}>Bank / port trade</button>
                      <button onClick={() => setDialog("trade")} disabled={!!game.pendingTrade}>
                        Trade with player
                      </button>
                    </>
                  )}
                  {has("endTurn") && (
                    <button className="primary" onClick={() => sendAction({ type: "endTurn" })}>End turn</button>
                  )}
                </div>
              )}
              {game.pendingTrade && game.pendingTrade.fromPlayerId === me && (
                <p className="muted">Waiting for {game.players.find((p) => p.id === game.pendingTrade?.toPlayerId)?.name} to answer your offer…</p>
              )}
            </section>
          )}

          {net.error && (
            <p className="error" onClick={clearError}>{net.error}</p>
          )}
        </aside>
      </div>

      {(owesDiscard || owesForcedDiscard) && <DiscardDialog game={game} ruleSet={ruleSet} me={me} />}
      {mustRespond && responseShape?.kind === "list" && (
        <PickPayload
          title={responseTitle(game, ruleSet)}
          options={responseOptions.map((payload) => ({ payload, label: describeResponse(game.pendingInteraction!.kind, payload, ruleSet) }))}
          onPick={(payload) => sendAction({ type: "respondInteraction", payload })}
          onClose={() => undefined}
          mandatory
        />
      )}
      {owesProgressDiscard && (
        <Modal title={`Too many progress cards — discard down to ${ruleSet.citiesAndKnights!.progressHandLimit}`}>
          <div className="row wrap">
            {Object.entries(countBy(player.progressCards)).map(([id, n]) => (
              <button key={id} className="chip" onClick={() => sendAction({ type: "discardProgressCard", cardId: id })}>
                {ruleSet.citiesAndKnights!.progressCards.find((d) => d.id === id)?.label ?? id} ×{n}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {typeof dialog === "object" && dialog !== null && "progress" in dialog && (
        <PickPayload
          title={ruleSet.citiesAndKnights!.progressCards.find((d) => d.id === dialog.progress)?.label ?? dialog.progress}
          options={progressPayloads(dialog.progress).map((payload) => ({ payload, label: describePayload(dialog.progress, payload, game, ruleSet) }))}
          onPick={(payload) => sendAction({ type: "playProgressCard", cardId: dialog.progress, payload })}
          onClose={() => setDialog(null)}
        />
      )}
      {tradeForMe && (
        <TradeResponse game={game} ruleSet={ruleSet} offer={tradeForMe} me={me} />
      )}
      {dialog === "bank" && <BankTradeDialog game={game} ruleSet={ruleSet} me={me} onClose={() => setDialog(null)} />}
      {dialog === "trade" && <PlayerTradeDialog game={game} ruleSet={ruleSet} me={me} onClose={() => setDialog(null)} />}
      {dialog === "monopoly" && (
        <PickResources
          title="Monopoly — take every card of one resource"
          count={1}
          onClose={() => setDialog(null)}
          onPick={([r]) => sendAction({ type: "playDevCard", cardId: "monopoly", payload: { resource: r } })}
        />
      )}
      {dialog === "yearOfPlenty" && (
        <PickResources
          title="Year of Plenty — take two resources from the bank"
          count={2}
          onClose={() => setDialog(null)}
          onPick={([a, b]) => sendAction({ type: "playDevCard", cardId: "yearOfPlenty", payload: { resources: [a, b] } })}
        />
      )}
      {over && <GameOver game={game} ruleSet={ruleSet} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function groupByHex(legal: Action[], kind: "moveRobber" | "knight"): Map<HexId, number[]> {
  const map = new Map<HexId, number[]>();
  for (const a of legal) {
    let hex: HexId | undefined;
    let stealFrom: number | undefined;
    if (kind === "moveRobber" && a.type === "moveRobber") {
      hex = a.hex;
      stealFrom = a.stealFrom;
    } else if (kind === "knight" && a.type === "playDevCard" && a.cardId === "knight") {
      const p = a.payload as { hex: HexId; stealFrom?: number };
      hex = p.hex;
      stealFrom = p.stealFrom;
    }
    if (hex === undefined) continue;
    const list = map.get(hex) ?? [];
    if (stealFrom !== undefined) list.push(stealFrom);
    map.set(hex, list);
  }
  return map;
}

function countBy(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

function statusText(game: GameState, ruleSet: RuleSet, me: number, mode: Mode): string {
  if (game.winner !== undefined) {
    const w = game.players.find((p) => p.id === game.winner)!;
    return `${w.name} wins with ${totalVictoryPoints(game, ruleSet, w.id)} points!`;
  }
  const current = game.players[game.turn.current]!;
  const mine = current.id === me;
  const who = mine ? "You" : current.name;

  if (game.turn.phase === "respond" && game.pendingInteraction) {
    const who = game.players.find((p) => p.id === game.pendingInteraction?.currentResponder)?.name;
    return game.pendingInteraction.currentResponder === me ? `${responseTitle(game, ruleSet)} — your answer is needed.` : `Waiting for ${who} to answer ${responseTitle(game, ruleSet).toLowerCase()}.`;
  }
  if (game.turn.phase === "forcedDiscard") {
    const names = (game.discardRequests ?? []).map((r) => (r.playerId === me ? "you" : game.players.find((p) => p.id === r.playerId)?.name)).join(", ");
    return (game.discardRequests ?? []).some((r) => r.playerId === me) ? "Saboteur! Discard half your hand." : `Saboteur — waiting for ${names} to discard.`;
  }
  if (game.pendingMetropolis) {
    const who = game.players.find((p) => p.id === game.pendingMetropolis?.playerId)?.name;
    return game.pendingMetropolis.playerId === me
      ? `You earned the ${game.pendingMetropolis.track} metropolis — click the city that gets it.`
      : `${who} is placing the ${game.pendingMetropolis.track} metropolis.`;
  }
  if ((game.pendingProgressDiscards ?? []).length > 0) {
    const names = game.pendingProgressDiscards!.map((id) => (id === me ? "you" : game.players.find((p) => p.id === id)?.name)).join(", ");
    return game.pendingProgressDiscards!.includes(me) ? "Too many progress cards — discard one." : `Waiting for ${names} to discard a progress card.`;
  }
  if ((game.pendingDowngrades ?? []).length > 0) {
    const names = game.pendingDowngrades!.map((id) => (id === me ? "you" : game.players.find((p) => p.id === id)?.name)).join(", ");
    return game.pendingDowngrades!.includes(me)
      ? "The barbarians won — click one of your cities to give up."
      : `The barbarians won — waiting for ${names} to give up a city.`;
  }
  if ((game.pendingDiscards ?? []).length > 0) {
    const names = game.pendingDiscards!.map((id) => (id === me ? "you" : game.players.find((p) => p.id === id)?.name)).join(", ");
    return `A 7! Waiting for ${names} to discard.`;
  }
  if (game.pendingTrade) {
    const to = game.players.find((p) => p.id === game.pendingTrade?.toPlayerId)?.name;
    return game.pendingTrade.toPlayerId === me ? `${current.name} offers you a trade.` : `${who} offered ${to} a trade.`;
  }
  if (mode.kind !== "idle") return "Choose on the board.";

  switch (game.turn.phase) {
    case "setupSettlement1":
    case "setupSettlement2": {
      const n = game.setupRound + 1;
      const nth = n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`;
      return mine ? `Place your ${nth} settlement.` : `${who} is placing a ${nth} settlement.`;
    }
    case "setupRoad1":
    case "setupRoad2":
      return mine ? "Place a road next to it." : `${who} is placing a road.`;
    case "rollDice":
      return mine ? "Your turn — roll the dice." : `${who} is about to roll.`;
    case "moveRobberAfterSeven":
      return mine ? "Move the robber." : `${who} is moving the robber.`;
    case "mainTurn":
      return mine ? "Your turn — build, trade, or end your turn." : `${who}'s turn.`;
    case "discard":
      return "Discarding…";
    case "barbarianDowngrade":
      return "The barbarians won…";
    case "progressDiscard":
      return "Waiting for a progress-card discard…";
    case "respond":
      return "Waiting for a response…";
    case "metropolisPlacement":
      return "Placing a metropolis…";
    case "gameOver":
      return "Game over.";
  }
}

// ---------------------------------------------------------------------------

function Players({ game, ruleSet, me, net }: { game: GameState; ruleSet: RuleSet; me: number; net: NetState }) {
  return (
    <section className="players">
      {game.players.map((p) => {
        const seat = net.snapshot?.seats.find((s) => s.playerId === p.id);
        const isCurrent = game.players[game.turn.current]?.id === p.id;
        const vp = p.id === me ? totalVictoryPoints(game, ruleSet, p.id) : p.victoryPoints;
        return (
          <div key={p.id} className={isCurrent ? "player current" : "player"}>
            <span className="swatch" style={{ background: PLAYER_COLORS[p.id] }} />
            <span className="pname">
              {p.name}
              {p.id === me && <span className="tag">you</span>}
              {seat && !seat.connected && <span className="tag warn">away</span>}
            </span>
            <span className="pstats" title="victory points · cards · dev cards · knights">
              <b>{vp}</b> VP · {handSize(p)} 🃏 · {p.devCards.length} 📜 · {p.playedKnights} ⚔️
            </span>
            <span className="awards">
              {game.longestRoadPlayerId === p.id && <span className="tag">longest road</span>}
              {game.largestArmyPlayerId === p.id && <span className="tag">largest army</span>}
            </span>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------

function useCounts(cards: readonly Card[]) {
  const [counts, setCounts] = useState<Partial<Record<Card, number>>>({});
  const get = (c: Card) => counts[c] ?? 0;
  const bump = (c: Card, d: number, max = 99) =>
    setCounts((cur) => ({ ...cur, [c]: Math.max(0, Math.min(max, (cur[c] ?? 0) + d)) }));
  const total = cards.reduce((s, c) => s + get(c), 0);
  const asPartial = (): CardCounts =>
    Object.fromEntries(cards.filter((c) => get(c) > 0).map((c) => [c, get(c)]));
  return { get, bump, total, asPartial };
}

function Counter({
  cards,
  get,
  bump,
  limit,
}: {
  cards: readonly Card[];
  get: (c: Card) => number;
  bump: (c: Card, d: number) => void;
  /** Cards actually held; when given, each row is capped at that. */
  limit?: (c: Card) => number;
}) {
  return (
    <div className="counter">
      {cards.map((c) => (
        <div key={c} className="counter-row">
          <span>{CARD_ICON[c]} {c}{limit ? <span className="muted"> ({limit(c)})</span> : null}</span>
          <span className="stepper">
            <button className="small" onClick={() => bump(c, -1)} disabled={get(c) === 0}>−</button>
            <b>{get(c)}</b>
            <button className="small" onClick={() => bump(c, 1)} disabled={limit ? get(c) >= limit(c) : false}>+</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {onClose && <div className="row end"><button onClick={onClose}>Cancel</button></div>}
      </div>
    </div>
  );
}

function DiscardDialog({ game, ruleSet, me }: { game: GameState; ruleSet: RuleSet; me: number }) {
  const player = game.players.find((p) => p.id === me)!;
  const need = discardCountFor(game, me, ruleSet);
  const cards = cardsIn(ruleSet);
  const { get, bump, total, asPartial } = useCounts(cards);
  const reason = game.turn.phase === "forcedDiscard" ? (game.discardRequests?.find((r) => r.playerId === me)?.reason ?? "forced") : "seven";
  return (
    <Modal title={reason === "seven" ? `A 7 was rolled — discard ${need} cards` : `${reason === "saboteur" ? "Saboteur!" : "Forced discard —"} discard ${need} cards`}>
      <Counter cards={cards} get={get} bump={(c, d) => bump(c, d, heldOf(player, c))} limit={(c) => heldOf(player, c)} />
      <div className="row end">
        <span className="muted">{total}/{need}</span>
        <button className="primary" disabled={total !== need} onClick={() => sendAction({ type: "discardCards", discard: asPartial() })}>
          Discard
        </button>
      </div>
    </Modal>
  );
}

function fmt(counts: CardCounts, devCards: string[] | undefined, ruleSet: RuleSet): string {
  const parts = cardsIn(ruleSet)
    .filter((c) => (counts[c] ?? 0) > 0)
    .map((c) => `${counts[c]} ${CARD_ICON[c]} ${c}`);
  for (const [id, n] of Object.entries(countBy(devCards ?? []))) {
    parts.push(`${n} × ${ruleSet.devCards.find((d) => d.id === id)?.label ?? id} 📜`);
  }
  return parts.length ? parts.join(", ") : "nothing";
}

/** Does `hand` contain every card in `wanted` (with multiplicity)? */
function holdsCards(hand: string[], wanted: string[]): boolean {
  const pool = [...hand];
  for (const id of wanted) {
    const i = pool.indexOf(id);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

function TradeResponse({ game, ruleSet, offer, me }: { game: GameState; ruleSet: RuleSet; offer: NonNullable<GameState["pendingTrade"]>; me: number }) {
  const from = game.players.find((p) => p.id === offer.fromPlayerId)!;
  const mine = game.players.find((p) => p.id === me)!;
  const canAccept =
    cardsIn(ruleSet).every((c) => heldOf(mine, c) >= (offer.receive[c] ?? 0)) &&
    holdsCards(mine.devCards, offer.receiveDevCards ?? []);
  return (
    <Modal title={`${from.name} proposes a trade`}>
      <p>They give you: <b>{fmt(offer.give, offer.giveDevCards, ruleSet)}</b></p>
      <p>You give them: <b>{fmt(offer.receive, offer.receiveDevCards, ruleSet)}</b></p>
      {!canAccept && <p className="error">You don't have what they're asking for.</p>}
      <div className="row end">
        <button onClick={() => sendAction({ type: "respondTrade", accept: false })}>Decline</button>
        <button className="primary" disabled={!canAccept} onClick={() => sendAction({ type: "respondTrade", accept: true })}>Accept</button>
      </div>
    </Modal>
  );
}

function BankTradeDialog({ game, ruleSet, me, onClose }: { game: GameState; ruleSet: RuleSet; me: number; onClose: () => void }) {
  const player = game.players.find((p) => p.id === me)!;
  const resourceRatios = tradeRatiosFor(game, ruleSet, me);
  const commodityRatio = commodityTradeRatioFor(game, ruleSet, me);
  const cards = cardsIn(ruleSet);
  const ratioOf = (c: Card) => (c in resourceRatios ? resourceRatios[c as Resource] : commodityRatio);
  const [give, setGive] = useState<Card | null>(null);
  const [receive, setReceive] = useState<Card | null>(null);
  const ok = give && receive && give !== receive && heldOf(player, give) >= ratioOf(give) && bankOf(game, receive) > 0;
  return (
    <Modal title="Trade with the bank" onClose={onClose}>
      <p className="muted">Give</p>
      <div className="row wrap">
        {cards.map((c) => (
          <button key={c} className={give === c ? "chip on" : "chip"} disabled={heldOf(player, c) < ratioOf(c)} onClick={() => setGive(c)}>
            {ratioOf(c)} {CARD_ICON[c]} {c}
          </button>
        ))}
      </div>
      <p className="muted">Receive</p>
      <div className="row wrap">
        {cards.map((c) => (
          <button key={c} className={receive === c ? "chip on" : "chip"} disabled={c === give || bankOf(game, c) === 0} onClick={() => setReceive(c)}>
            1 {CARD_ICON[c]} {c}
          </button>
        ))}
      </div>
      <div className="row end">
        <button className="primary" disabled={!ok} onClick={() => {
          sendAction({ type: "proposeTrade", offer: { fromPlayerId: me, give: { [give!]: ratioOf(give!) }, receive: { [receive!]: 1 } } });
          onClose();
        }}>
          Trade
        </button>
      </div>
    </Modal>
  );
}

/** Per-card-id counters for a dev-card side of a trade (house rule #1). */
function DevCardCounter({
  label,
  counts,
  onChange,
  limit,
  ruleSet,
}: {
  label: string;
  counts: Record<string, number>;
  onChange: (id: string, n: number) => void;
  /** Cards actually held; when given, only those ids are offered and capped. */
  limit?: Record<string, number>;
  ruleSet: RuleSet;
}) {
  const ids = limit ? Object.keys(limit) : ruleSet.devCards.map((d) => d.id);
  if (ids.length === 0) return null;
  return (
    <div className="counter" data-testid={label}>
      {ids.map((id) => {
        const n = counts[id] ?? 0;
        const max = limit ? limit[id]! : 99;
        return (
          <div key={id} className="counter-row">
            <span>📜 {ruleSet.devCards.find((d) => d.id === id)?.label ?? id}{limit ? <span className="muted"> ({max})</span> : null}</span>
            <span className="stepper">
              <button className="small" onClick={() => onChange(id, n - 1)} disabled={n === 0}>−</button>
              <b>{n}</b>
              <button className="small" onClick={() => onChange(id, n + 1)} disabled={n >= max}>+</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function expandCounts(counts: Record<string, number>): string[] {
  return Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => id));
}

function PlayerTradeDialog({ game, ruleSet, me, onClose }: { game: GameState; ruleSet: RuleSet; me: number; onClose: () => void }) {
  const player = game.players.find((p) => p.id === me)!;
  const others = game.players.filter((p) => p.id !== me);
  const [to, setTo] = useState<number>(others[0]!.id);
  const cards = cardsIn(ruleSet);
  const give = useCounts(cards);
  const receive = useCounts(cards);
  const devCardsOn = ruleSet.houseRules.tradeDevCards;
  const [giveCards, setGiveCards] = useState<Record<string, number>>({});
  const [wantCards, setWantCards] = useState<Record<string, number>>({});
  const bump = (set: typeof setGiveCards) => (id: string, n: number) =>
    set((c) => ({ ...c, [id]: Math.max(0, n) }));
  const giveCardList = expandCounts(giveCards);
  const wantCardList = expandCounts(wantCards);
  const givesSomething = give.total > 0 || giveCardList.length > 0;
  const wantsSomething = receive.total > 0 || wantCardList.length > 0;
  const ok = givesSomething && wantsSomething;
  return (
    <Modal title="Propose a trade" onClose={onClose}>
      <div className="row wrap">
        {others.map((p) => (
          <button key={p.id} className={to === p.id ? "chip on" : "chip"} onClick={() => setTo(p.id)}>
            <span className="swatch" style={{ background: PLAYER_COLORS[p.id] }} /> {p.name}
          </button>
        ))}
      </div>
      <p className="muted">You give</p>
      <Counter cards={cards} get={give.get} bump={(c, d) => give.bump(c, d, heldOf(player, c))} limit={(c) => heldOf(player, c)} />
      {devCardsOn && (
        <DevCardCounter label="give-dev-cards" ruleSet={ruleSet} counts={giveCards} onChange={bump(setGiveCards)} limit={countBy(player.devCards)} />
      )}
      <p className="muted">You want</p>
      <Counter cards={cards} get={receive.get} bump={receive.bump} />
      {devCardsOn && (
        <DevCardCounter label="want-dev-cards" ruleSet={ruleSet} counts={wantCards} onChange={bump(setWantCards)} />
      )}
      <div className="row end">
        <button className="primary" disabled={!ok} onClick={() => {
          sendAction({
            type: "proposeTrade",
            offer: {
              fromPlayerId: me,
              toPlayerId: to,
              give: give.asPartial(),
              receive: receive.asPartial(),
              ...(giveCardList.length ? { giveDevCards: giveCardList } : {}),
              ...(wantCardList.length ? { receiveDevCards: wantCardList } : {}),
            },
          });
          onClose();
        }}>
          Offer
        </button>
      </div>
    </Modal>
  );
}

function responseTitle(game: GameState, ruleSet: RuleSet): string {
  const pi = game.pendingInteraction;
  if (!pi) return "";
  const from = game.players.find((p) => p.id === pi.sourcePlayerId)?.name ?? "someone";
  const card = pi.sourceCardId ? ruleSet.citiesAndKnights?.progressCards.find((d) => d.id === pi.sourceCardId)?.label ?? pi.sourceCardId : undefined;
  switch (pi.kind) {
    case "commercialHarbor":
      return `${from}'s Commercial Harbor: give a commodity for their ${String((pi.payload as { offers: Record<number, string> }).offers[pi.currentResponder])}`;
    case "wedding":
      return `${from}'s Wedding: give 2 cards`;
    case "deserterChoose":
      return `${from}'s Deserter: choose the knight you lose`;
    case "deserterPlace":
      return "Deserter: place the knight you gained";
    case "diplomatReplace":
      return "Diplomat: re-place your road";
    case "displaceKnight":
      return `${card ? `${from}'s ${card}` : `${from}'s knight`}: your knight was pushed — choose where it goes`;
  }
}

function describeResponse(kind: NonNullable<GameState["pendingInteraction"]>["kind"], payload: unknown, _ruleSet: RuleSet): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (Object.keys(p).length === 0) return kind === "commercialHarbor" ? "I have no commodity to give" : "Decline";
  if (kind === "commercialHarbor") return `${CARD_ICON[p.commodity as Card]} ${String(p.commodity)}`;
  if (kind === "wedding") return Object.entries(p.cards as Record<string, number>).map(([c, n]) => `${n} ${CARD_ICON[c as Card]} ${c}`).join(" + ");
  return JSON.stringify(payload);
}

/** Human-readable label for a progress-card payload, for the picker. */
function describePayload(cardId: string, payload: unknown, game: GameState, ruleSet: RuleSet): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (cardId) {
    case "resourceMonopoly":
      return `${CARD_ICON[p.resource as Card]} ${String(p.resource)}`;
    case "tradeMonopoly":
      return `${CARD_ICON[p.commodity as Card]} ${String(p.commodity)}`;
    case "merchantFleet":
      return `${CARD_ICON[p.card as Card]} ${String(p.card)} at 2:1`;
    case "spy": {
      const who = game.players.find((x) => x.id === p.playerId)?.name ?? `P${String(p.playerId)}`;
      const card = ruleSet.citiesAndKnights?.progressCards.find((d) => d.id === p.cardId)?.label ?? String(p.cardId);
      return `${who}: ${card}`;
    }
    case "alchemist": {
      const [a, b] = p.dice as [number, number];
      return `${a} + ${b}`;
    }
    case "smith": {
      const vs = p.vertices as string[];
      return vs.length === 2 ? "Promote both knights" : `Promote knight ${vs[0]?.slice(2)}`;
    }
    case "crane":
      return `${TRACK_LABEL[p.track as ImprovementTrack]} for one less`;
    case "masterMerchant": {
      const who = game.players.find((x) => x.id === p.playerId)?.name ?? `P${String(p.playerId)}`;
      const cards = Object.entries(p.cards as Record<string, number>).map(([c, n]) => `${n} ${CARD_ICON[c as Card]} ${c}`).join(", ");
      return `${who}: take ${cards}`;
    }
    default:
      return JSON.stringify(payload);
  }
}

function PickPayload({ title, options, onPick, onClose, mandatory }: { title: string; options: { payload: unknown; label: string }[]; onPick: (payload: unknown) => void; onClose: () => void; mandatory?: boolean }) {
  return (
    <Modal title={title} onClose={mandatory ? undefined : onClose}>
      <div className="row wrap">
        {options.map((o, i) => (
          <button key={i} className="chip" onClick={() => { onPick(o.payload); onClose(); }}>
            {o.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PickResources({ title, count, onPick, onClose }: { title: string; count: 1 | 2; onPick: (picked: Resource[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<Resource[]>([]);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="row wrap">
        {RESOURCES.map((r) => (
          <button key={r} className="chip" onClick={() => {
            const next = [...picked, r];
            if (next.length === count) {
              onPick(next);
              onClose();
            } else setPicked(next);
          }}>
            {RESOURCE_ICON[r]} {r}
          </button>
        ))}
      </div>
      {picked.length > 0 && <p className="muted">Picked: {picked.join(", ")}</p>}
    </Modal>
  );
}

function GameOver({ game, ruleSet }: { game: GameState; ruleSet: RuleSet }) {
  const winner = game.players.find((p) => p.id === game.winner)!;
  const rows = [...game.players]
    .map((p) => ({ p, vp: totalVictoryPoints(game, ruleSet, p.id) }))
    .sort((a, b) => b.vp - a.vp);
  return (
    <Modal title={`${winner.name} wins!`}>
      <ol className="scores">
        {rows.map(({ p, vp }) => (
          <li key={p.id}>
            <span className="swatch" style={{ background: PLAYER_COLORS[p.id] }} /> {p.name} — {vp} VP
          </li>
        ))}
      </ol>
      <div className="row end"><button className="primary" onClick={leaveRoom}>Back to home</button></div>
    </Modal>
  );
}
