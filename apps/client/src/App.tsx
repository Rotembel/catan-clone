import { useEffect, useState } from "react";
import { resumeSession, useNet } from "./net.js";
import { Game } from "./components/Game.js";
import { Home } from "./components/Home.js";
import { Lobby } from "./components/Lobby.js";

export function App() {
  const net = useNet();
  const [resuming, setResuming] = useState(true);

  // On load, try to get back into the last room (a refresh mid-game).
  useEffect(() => {
    void resumeSession().finally(() => setResuming(false));
  }, []);

  if (resuming && net.screen !== "lobby" && net.screen !== "game") {
    return <div className="home"><p className="muted">Reconnecting…</p></div>;
  }

  switch (net.screen) {
    case "home":
    case "connecting":
      return <Home net={net} />;
    case "lobby":
      return <Lobby net={net} />;
    case "game":
      if (!net.game || !net.ruleSet || !net.seat) {
        return <div className="home"><p className="muted">Loading game…</p></div>;
      }
      return <Game net={net} game={net.game} ruleSet={net.ruleSet} me={net.seat.playerId} />;
  }
}
