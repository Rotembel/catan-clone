// The game screen. Everything here is derived from the last GameState the
// server sent; the engine is only consulted for *hints* (what's legal), and
// every click becomes an intent sent to the server (SPEC.md §1).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RESOURCES,
  discardCountFor,
  legalActions,
  legalRoadEdges,
  totalCards,
  totalVictoryPoints,
  tradeRatiosFor,
  tryApply,
} from "@catan/engine";
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  Resource,
  RuleSet,
  VertexId,
} from "@catan/shared";
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

type Mode =
  | { kind: "idle" }
  | { kind: "knight" }
  | { kind: "roadBuilding"; edges: EdgeId[] }
  | { kind: "victim"; hex: HexId; victims: number[]; viaKnight: boolean };

type Dialog = "bank" | "trade" | "monopoly" | "yearOfPlenty" | null;

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
  const knightMoves = useMemo(() => groupByHex(legal, "knight"), [legal]);

  const canPlay = (cardId: string) =>
    legal.some((a) => a.type === "playDevCard" && a.cardId === cardId);

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
      case "knight":
        return { ...none, hexes: new Set(knightMoves.keys()) };
      case "roadBuilding":
        return { ...none, edges: roadBuildingEdges, selectedEdges: new Set(mode.edges) };
      case "victim":
        return none;
      case "idle":
        return {
          vertices: new Set([...settlementVertices, ...cityVertices]),
          edges: roadEdges,
          hexes: new Set(robberMoves.keys()),
          selectedEdges: new Set<EdgeId>(),
        };
    }
  }, [mode, over, knightMoves, roadBuildingEdges, settlementVertices, cityVertices, roadEdges, robberMoves]);

  const onVertex = (v: VertexId) => {
    if (cityVertices.has(v)) sendAction({ type: "buildCity", vertex: v });
    else if (settlementVertices.has(v)) sendAction({ type: "buildSettlement", vertex: v });
  };

  const onEdge = (e: EdgeId) => {
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
    if (mode.kind === "knight") {
      const victims = knightMoves.get(h);
      if (victims) moveRobberTo(h, victims, true);
      return;
    }
    const victims = robberMoves.get(h);
    if (victims) moveRobberTo(h, victims, false);
  };

  const owesDiscard = (game.pendingDiscards ?? []).includes(me);
  const tradeForMe = game.pendingTrade?.toPlayerId === me ? game.pendingTrade : undefined;

  return (
    <div className="game">
      <header className="topbar">
        <div>
          <strong>Room {net.code}</strong>
          {!net.connected && <span className="tag warn">reconnecting…</span>}
        </div>
        <div className="status">{statusText(game, ruleSet, me, mode)}</div>
        <button className="small" onClick={leaveRoom}>Leave</button>
      </header>

      <div className="layout">
        <div className="board-wrap">
          <Board game={game} ruleSet={ruleSet} targets={targets} onVertex={onVertex} onEdge={onEdge} onHex={onHex} />
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
            <h3>Your hand <span className="muted">({totalCards(player.resources)})</span></h3>
            <div className="resources">
              {RESOURCES.map((r) => (
                <span key={r} className="res" title={r}>
                  {RESOURCE_ICON[r]} {player.resources[r]}
                </span>
              ))}
            </div>
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
                        if (id === "knight") setMode({ kind: "knight" });
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

          {!over && (
            <section className="actions">
              {mode.kind !== "idle" ? (
                <div className="row">
                  <span className="muted">
                    {mode.kind === "knight" && "Pick a hex for the robber."}
                    {mode.kind === "roadBuilding" && `Pick ${2 - mode.edges.length} more road${mode.edges.length === 1 ? "" : "s"}.`}
                    {mode.kind === "victim" && "Steal from:"}
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
                  {mode.kind === "roadBuilding" && mode.edges.length === 1 && roadBuildingEdges.size === 0 && (
                    <button className="small" onClick={() => sendAction({ type: "playDevCard", cardId: "roadBuilding", payload: { edges: mode.edges } })}>
                      Build just one
                    </button>
                  )}
                  <button className="small" onClick={() => setMode({ kind: "idle" })}>Cancel</button>
                </div>
              ) : (
                <div className="row wrap">
                  {has("rollDice") && (
                    <button className="primary" onClick={() => sendAction({ type: "rollDice" })}>Roll dice</button>
                  )}
                  {has("buyDevCard") && (
                    <button onClick={() => sendAction({ type: "buyDevCard" })}>Buy dev card</button>
                  )}
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

      {owesDiscard && <DiscardDialog game={game} me={me} />}
      {tradeForMe && (
        <TradeResponse game={game} offer={tradeForMe} me={me} />
      )}
      {dialog === "bank" && <BankTradeDialog game={game} ruleSet={ruleSet} me={me} onClose={() => setDialog(null)} />}
      {dialog === "trade" && <PlayerTradeDialog game={game} me={me} onClose={() => setDialog(null)} />}
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
      return mine ? "Place your first settlement." : `${who} is placing a first settlement.`;
    case "setupRoad1":
      return mine ? "Place a road next to it." : `${who} is placing a road.`;
    case "setupSettlement2":
      return mine ? "Place your second settlement." : `${who} is placing a second settlement.`;
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
              <b>{vp}</b> VP · {totalCards(p.resources)} 🃏 · {p.devCards.length} 📜 · {p.playedKnights} ⚔️
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

function useCounts(initial: Partial<Record<Resource, number>> = {}) {
  const [counts, setCounts] = useState<Record<Resource, number>>({
    wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...initial,
  });
  const bump = (r: Resource, d: number, max = 99) =>
    setCounts((c) => ({ ...c, [r]: Math.max(0, Math.min(max, c[r] + d)) }));
  const total = RESOURCES.reduce((s, r) => s + counts[r], 0);
  const asPartial = (): Partial<Record<Resource, number>> =>
    Object.fromEntries(RESOURCES.filter((r) => counts[r] > 0).map((r) => [r, counts[r]]));
  return { counts, bump, total, asPartial };
}

function Counter({ counts, bump, limit }: { counts: Record<Resource, number>; bump: (r: Resource, d: number) => void; limit?: Record<Resource, number> }) {
  return (
    <div className="counter">
      {RESOURCES.map((r) => (
        <div key={r} className="counter-row">
          <span>{RESOURCE_ICON[r]} {r}{limit ? <span className="muted"> ({limit[r]})</span> : null}</span>
          <span className="stepper">
            <button className="small" onClick={() => bump(r, -1)} disabled={counts[r] === 0}>−</button>
            <b>{counts[r]}</b>
            <button className="small" onClick={() => bump(r, 1)} disabled={limit ? counts[r] >= limit[r] : false}>+</button>
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

function DiscardDialog({ game, me }: { game: GameState; me: number }) {
  const player = game.players.find((p) => p.id === me)!;
  const need = discardCountFor(game, me);
  const { counts, bump, total, asPartial } = useCounts();
  return (
    <Modal title={`A 7 was rolled — discard ${need} cards`}>
      <Counter counts={counts} bump={(r, d) => bump(r, d, player.resources[r])} limit={player.resources} />
      <div className="row end">
        <span className="muted">{total}/{need}</span>
        <button className="primary" disabled={total !== need} onClick={() => sendAction({ type: "discardCards", discard: asPartial() })}>
          Discard
        </button>
      </div>
    </Modal>
  );
}

function fmt(res: Partial<Record<Resource, number>>): string {
  const parts = RESOURCES.filter((r) => (res[r] ?? 0) > 0).map((r) => `${res[r]} ${RESOURCE_ICON[r]} ${r}`);
  return parts.length ? parts.join(", ") : "nothing";
}

function TradeResponse({ game, offer, me }: { game: GameState; offer: NonNullable<GameState["pendingTrade"]>; me: number }) {
  const from = game.players.find((p) => p.id === offer.fromPlayerId)!;
  const mine = game.players.find((p) => p.id === me)!;
  const canAccept = RESOURCES.every((r) => mine.resources[r] >= (offer.receive[r] ?? 0));
  return (
    <Modal title={`${from.name} proposes a trade`}>
      <p>They give you: <b>{fmt(offer.give)}</b></p>
      <p>You give them: <b>{fmt(offer.receive)}</b></p>
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
  const ratios = tradeRatiosFor(game, ruleSet, me);
  const [give, setGive] = useState<Resource | null>(null);
  const [receive, setReceive] = useState<Resource | null>(null);
  const ok = give && receive && give !== receive && player.resources[give] >= ratios[give] && game.bank[receive] > 0;
  return (
    <Modal title="Trade with the bank" onClose={onClose}>
      <p className="muted">Give</p>
      <div className="row wrap">
        {RESOURCES.map((r) => (
          <button key={r} className={give === r ? "chip on" : "chip"} disabled={player.resources[r] < ratios[r]} onClick={() => setGive(r)}>
            {ratios[r]} {RESOURCE_ICON[r]} {r}
          </button>
        ))}
      </div>
      <p className="muted">Receive</p>
      <div className="row wrap">
        {RESOURCES.map((r) => (
          <button key={r} className={receive === r ? "chip on" : "chip"} disabled={r === give || game.bank[r] === 0} onClick={() => setReceive(r)}>
            1 {RESOURCE_ICON[r]} {r}
          </button>
        ))}
      </div>
      <div className="row end">
        <button className="primary" disabled={!ok} onClick={() => {
          sendAction({ type: "proposeTrade", offer: { fromPlayerId: me, give: { [give!]: ratios[give!] }, receive: { [receive!]: 1 } } });
          onClose();
        }}>
          Trade
        </button>
      </div>
    </Modal>
  );
}

function PlayerTradeDialog({ game, me, onClose }: { game: GameState; me: number; onClose: () => void }) {
  const player = game.players.find((p) => p.id === me)!;
  const others = game.players.filter((p) => p.id !== me);
  const [to, setTo] = useState<number>(others[0]!.id);
  const give = useCounts();
  const receive = useCounts();
  const ok = give.total > 0 && receive.total > 0;
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
      <Counter counts={give.counts} bump={(r, d) => give.bump(r, d, player.resources[r])} limit={player.resources} />
      <p className="muted">You want</p>
      <Counter counts={receive.counts} bump={receive.bump} />
      <div className="row end">
        <button className="primary" disabled={!ok} onClick={() => {
          sendAction({ type: "proposeTrade", offer: { fromPlayerId: me, toPlayerId: to, give: give.asPartial(), receive: receive.asPartial() } });
          onClose();
        }}>
          Offer
        </button>
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
