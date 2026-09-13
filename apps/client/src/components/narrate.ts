// "Bot Ada rolled 8" — a one-line narration of the server's last applied
// action, from the authoritative envelope + resulting state. Pure.

import type { ActionEnvelope, GameState, RuleSet } from "@catan/shared";

const EVENT_LABEL: Record<string, string> = { barbarian: "⛵ barbarians", trade: "🧵 trade gate", politics: "🪙 politics gate", science: "📜 science gate" };

export function narrate(last: ActionEnvelope | undefined, game: GameState, ruleSet: RuleSet, me: number): string | undefined {
  if (!last) return undefined;
  const who = game.players.find((p) => p.id === last.playerId);
  if (!who) return undefined;
  const name = who.id === me ? "You" : who.name;
  const a = last.action;
  switch (a.type) {
    case "rollDice": {
      const [d1, d2] = game.dice ?? [0, 0];
      const event = game.eventDie && ruleSet.citiesAndKnights ? ` · ${EVENT_LABEL[game.eventDie] ?? game.eventDie}` : "";
      return `${name} rolled ${d1 + d2} (${d1}+${d2})${event}`;
    }
    case "buildRoad": return `${name} built a road`;
    case "buildSettlement": return `${name} built a settlement`;
    case "buildCity": return `${name} built a city`;
    case "buyDevCard": return `${name} bought a development card`;
    case "playDevCard": return `${name} played ${ruleSet.devCards.find((d) => d.id === a.cardId)?.label ?? a.cardId}`;
    case "moveRobber": return `${name} moved the robber`;
    case "discardCards": return `${name} discarded`;
    case "proposeTrade": {
      if (a.offer.toPlayerId === undefined) return `${name} traded with the bank`;
      const to = game.players.find((p) => p.id === a.offer.toPlayerId)?.name ?? "someone";
      return `${name} offered ${to} a trade`;
    }
    case "respondTrade": return `${name} ${a.accept ? "accepted" : "declined"} the trade`;
    case "buildImprovement": return `${name} improved ${a.track}`;
    case "buildKnight": return `${name} built a knight`;
    case "activateKnight": return `${name} activated a knight`;
    case "promoteKnight": return `${name} promoted a knight`;
    case "moveKnight": return `${name} moved a knight`;
    case "downgradeCity": return `${name} lost a city to the barbarians`;
    case "playProgressCard": return `${name} played ${ruleSet.citiesAndKnights?.progressCards.find((d) => d.id === a.cardId)?.label ?? a.cardId}`;
    case "discardProgressCard": return `${name} discarded a progress card`;
    case "buildWall": return `${name} built a city wall`;
    case "placeMetropolis": return `${name} placed a metropolis`;
    case "respondInteraction": return `${name} answered`;
    case "endTurn": return `${name} ended the turn`;
    default: return undefined;
  }
}

/** What a bot seat is about to do, from state alone (shown while its pause runs). */
export function botIntent(game: GameState, isBot: (playerId: number) => boolean): string | undefined {
  const current = game.players[game.turn.current];
  if (!current || !isBot(current.id) || game.winner !== undefined) return undefined;
  if (game.pendingTrade?.toPlayerId !== undefined && isBot(game.pendingTrade.toPlayerId)) {
    return `${game.players.find((p) => p.id === game.pendingTrade!.toPlayerId)?.name} is considering the trade…`;
  }
  if (game.turn.phase === "rollDice") return `${current.name} is rolling…`;
  if (game.turn.phase === "mainTurn") return `${current.name} is thinking…`;
  return undefined;
}
