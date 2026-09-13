import { useState } from "react";
import { DEFAULT_RULE_SET_ID, RULE_SETS, ruleSetInfo } from "@catan/rulesets";
import { MIN_PLAYERS, MAX_PLAYERS } from "@catan/shared";
import { addBot, leaveRoom, removeBot, startGame, type NetState } from "../net.js";
import { PLAYER_COLORS } from "./colors.js";

export function Lobby({ net }: { net: NetState }) {
  const seats = net.snapshot?.seats ?? [];
  const me = seats.find((s) => s.playerId === net.seat?.playerId);
  const [ruleSetId, setRuleSetId] = useState(DEFAULT_RULE_SET_ID);
  const chosen = ruleSetInfo(ruleSetId);
  const humans = seats.filter((s) => s.kind === "human").length;
  const bots = seats.length - humans;
  const inRange = !!chosen && seats.length >= chosen.seats.min && seats.length <= chosen.seats.max;
  const canStart = !!me?.isHost && seats.length >= MIN_PLAYERS && inRange;
  const build = net.snapshot?.build;

  return (
    <div className="lobby">
      <h1>Room {net.code}</h1>
      <p className="muted">
        Share this code. {seats.length}/{MAX_PLAYERS} seats taken — {humans} human{humans === 1 ? "" : "s"}, {bots} bot{bots === 1 ? "" : "s"}.
        {seats.length < MIN_PLAYERS ? ` Need at least ${MIN_PLAYERS} to start.` : ""}
      </p>

      <ul className="seats">
        {seats.map((s) => (
          <li key={s.playerId}>
            <span className="swatch" style={{ background: PLAYER_COLORS[s.playerId] }} />
            {s.name}
            {s.kind === "bot" && <span className="tag">bot</span>}
            {s.isHost && <span className="tag">host</span>}
            {s.playerId === net.seat?.playerId && <span className="tag">you</span>}
            {s.kind === "human" && !s.connected && <span className="tag warn">away</span>}
            {me?.isHost && s.kind === "bot" && (
              <button className="small seat-action" onClick={() => removeBot(s.playerId)}>Remove</button>
            )}
          </li>
        ))}
      </ul>

      {me?.isHost && (
        <div className="row">
          <button className="small" disabled={seats.length >= MAX_PLAYERS} onClick={addBot}>
            Add bot
          </button>
          <span className="muted">Bots play from the server — no extra device needed.</span>
        </div>
      )}

      {me?.isHost && (
        <label>
          Rules
          <select value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)} aria-label="rule set">
            {RULE_SETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.seats.min}–{r.seats.max} seats)
              </option>
            ))}
          </select>
          {chosen && <span className="muted">{chosen.description}</span>}
          {chosen && !inRange && (
            <span className="error">
              {chosen.label} needs {chosen.seats.min}–{chosen.seats.max} seats; this room has {seats.length}.
            </span>
          )}
        </label>
      )}

      <div className="row">
        {me?.isHost ? (
          <button className="primary" disabled={!canStart} onClick={() => startGame(ruleSetId)}>
            Start game
          </button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
        <button onClick={leaveRoom}>Leave</button>
      </div>

      {build && (
        <p className="muted diagnostics" data-testid="diagnostics">
          v{build.appVersion} · {build.gitCommit} · {build.buildProfile} · {build.mapGenerationVersion} · saves: {net.snapshot?.persistence}
          {net.connected ? " · connected" : " · disconnected"}
        </p>
      )}

      {net.error && <p className="error">{net.error}</p>}
    </div>
  );
}
