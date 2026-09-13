import { useState } from "react";
import { DEFAULT_RULE_SET_ID, RULE_SETS, ruleSetInfo } from "@catan/rulesets";
import { MIN_PLAYERS, MAX_PLAYERS } from "@catan/shared";
import { leaveRoom, startGame, type NetState } from "../net.js";
import { PLAYER_COLORS } from "./colors.js";

export function Lobby({ net }: { net: NetState }) {
  const seats = net.snapshot?.seats ?? [];
  const me = seats.find((s) => s.playerId === net.seat?.playerId);
  const canStart = !!me?.isHost && seats.length >= MIN_PLAYERS;
  const [ruleSetId, setRuleSetId] = useState(DEFAULT_RULE_SET_ID);
  const chosen = ruleSetInfo(ruleSetId);

  return (
    <div className="lobby">
      <h1>Room {net.code}</h1>
      <p className="muted">
        Share this code. {seats.length}/{MAX_PLAYERS} seats taken
        {seats.length < MIN_PLAYERS ? ` — need at least ${MIN_PLAYERS} to start.` : "."}
      </p>

      <ul className="seats">
        {seats.map((s) => (
          <li key={s.playerId}>
            <span className="swatch" style={{ background: PLAYER_COLORS[s.playerId] }} />
            {s.name}
            {s.isHost && <span className="tag">host</span>}
            {s.playerId === net.seat?.playerId && <span className="tag">you</span>}
            {!s.connected && <span className="tag warn">away</span>}
          </li>
        ))}
      </ul>

      {me?.isHost && (
        <label>
          Rules
          <select value={ruleSetId} onChange={(e) => setRuleSetId(e.target.value)} aria-label="rule set">
            {RULE_SETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          {chosen && <span className="muted">{chosen.description}</span>}
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

      {net.error && <p className="error">{net.error}</p>}
    </div>
  );
}
