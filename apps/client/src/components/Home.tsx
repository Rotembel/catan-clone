import { useState, type FormEvent } from "react";
import { createRoom, forgetSession, joinRoom, resumeSession, storedSessions, type NetState } from "../net.js";

export function Home({ net }: { net: NetState }) {
  const [name, setName] = useState(net.name || "");
  const [code, setCode] = useState("");
  const busy = net.screen === "connecting";
  const sessions = storedSessions();

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void createRoom(name.trim());
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || code.trim().length < 4) return;
    void joinRoom(code, name.trim());
  };

  return (
    <div className="home">
      <h1>Settlers</h1>
      <p className="muted">Create a room and share the code, or join a friend's.</p>

      {sessions.length > 0 && (
        <div className="resume" data-testid="resume">
          <p className="muted">You have a seat in:</p>
          {sessions.map((s) => (
            <div key={s.code} className="row">
              <button className="primary" disabled={busy} onClick={() => void resumeSession(s.code)}>
                Resume room {s.code} as {s.name}
              </button>
              <button className="small" disabled={busy} onClick={() => forgetSession(s.code)} title="Forget this seat">
                Forget
              </button>
            </div>
          ))}
        </div>
      )}

      <label>
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="Ada"
          autoFocus
        />
      </label>

      <div className="home-actions">
        <form onSubmit={onCreate}>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            Create a room
          </button>
        </form>

        <form onSubmit={onJoin} className="join">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="CODE"
            className="code-input"
            aria-label="room code"
          />
          <button type="submit" disabled={busy || !name.trim() || code.trim().length < 4}>
            Join
          </button>
        </form>
      </div>

      {busy && <p className="muted">Connecting…</p>}
      {net.error && <p className="error">{net.error}</p>}
    </div>
  );
}
