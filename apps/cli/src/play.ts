// Pass-and-play harness: runs a full base game and prints what happened.
//
//   pnpm --filter @catan/cli play              # default seed
//   pnpm --filter @catan/cli play -- --seed=x  # pick a seed
//   pnpm --filter @catan/cli play -- --verbose # print every action
//   pnpm --filter @catan/cli play -- --rules=cities-and-knights

import { totalVictoryPoints } from "@catan/engine";
import type { ActionEnvelope, GameState } from "@catan/shared";
import { runGame, scoreboard } from "./runGame.js";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const seed = arg("seed", "game-1");
const ruleSetId = arg("rules", "base");
const verbose = process.argv.includes("--verbose");

function describe(envelope: ActionEnvelope, state: GameState): string {
  const name = state.players.find((p) => p.id === envelope.playerId)?.name ?? `P${envelope.playerId}`;
  const action = envelope.action;
  switch (action.type) {
    case "rollDice":
      return `${name} rolls ${state.dice?.[0]} + ${state.dice?.[1]} = ${(state.dice?.[0] ?? 0) + (state.dice?.[1] ?? 0)}`;
    case "buildSettlement":
      return `${name} builds a settlement`;
    case "buildCity":
      return `${name} upgrades to a city`;
    case "buildRoad":
      return `${name} builds a road`;
    case "buyDevCard":
      return `${name} buys a development card`;
    case "playDevCard":
      return `${name} plays ${action.cardId}`;
    case "moveRobber":
      return `${name} moves the robber${action.stealFrom !== undefined ? ` and steals from P${action.stealFrom}` : ""}`;
    case "discardCards":
      return `${name} discards`;
    case "proposeTrade":
      return `${name} trades with the bank`;
    case "respondTrade":
      return `${name} ${action.accept ? "accepts" : "declines"} a trade`;
    case "buildImprovement":
      return `${name} improves ${action.track}`;
    case "buildKnight":
      return `${name} builds a knight`;
    case "activateKnight":
      return `${name} activates a knight`;
    case "promoteKnight":
      return `${name} promotes a knight`;
    case "moveKnight":
      return `${name} moves a knight`;
    case "downgradeCity":
      return `${name} loses a city to the barbarians`;
    case "endTurn":
      return `${name} ends their turn`;
  }
}

console.log(`\nCatan — base game, seed "${seed}"\n`);

let turns = 0;
const result = runGame({
  seed,
  ruleSetId,
  onAction: (envelope, state) => {
    if (envelope.action.type === "endTurn") turns++;
    if (verbose) console.log(`  ${describe(envelope, state)}`);
  },
});

console.log(`\nBoard: ${result.ruleSet.board.hexes.length} hexes, ${result.ruleSet.board.ports.length} ports`);
console.log(`Played ${result.actions} actions over ${turns} turns.\n`);

for (const line of scoreboard(result.state, result.ruleSet)) {
  console.log(`  ${line}`);
}

if (result.winner !== undefined) {
  const winner = result.state.players.find((p) => p.id === result.winner)!;
  const vp = totalVictoryPoints(result.state, result.ruleSet, winner.id);
  console.log(`\n${winner.name} wins with ${vp} victory points.\n`);
} else {
  console.log(`\nNo winner: the game hit the action cap.\n`);
  process.exitCode = 1;
}
