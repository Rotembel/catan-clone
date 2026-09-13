// Moving the robber and stealing — shared by the after-a-seven move and
// the Knight card.

import type { GameState, HexId, RuleSet } from "@catan/shared";
import { hexVertices } from "../board/geometry.js";
import { getGeometry } from "../geometryCache.js";
import { addResources, expandHand, subtractResources, totalCards } from "../resources.js";
import { nextInt } from "../rng.js";
import { illegal, refresh, requireCurrentPlayer, requirePhase } from "./helpers.js";

/** Players with a building on `hex` who hold at least one resource card. */
export function stealTargetsAt(
  state: GameState,
  ruleSet: RuleSet,
  hex: HexId,
  thiefId: number
): number[] {
  const geometry = getGeometry(ruleSet.board);
  const cube = geometry.hexes.get(hex);
  if (!cube) return [];

  const victims = new Set<number>();
  for (const vertex of hexVertices(cube)) {
    const building = state.board.buildings[vertex];
    if (!building || building.playerId === thiefId) continue;
    const victim = state.players.find((p) => p.id === building.playerId);
    if (victim && totalCards(victim.resources) > 0) victims.add(building.playerId);
  }
  return [...victims].sort((a, b) => a - b);
}

/**
 * Core robber move, without phase checks — the Knight card reuses this from
 * a different phase than the after-a-seven move does.
 */
export function applyRobberMove(
  state: GameState,
  ruleSet: RuleSet,
  thiefId: number,
  hex: HexId,
  stealFrom: number | undefined
): GameState {
  const geometry = getGeometry(ruleSet.board);
  if (!geometry.hexes.has(hex)) illegal(`no such hex on this board: ${hex}`);
  if (hex === state.board.robberHex) illegal("the robber must move to a different hex");

  let next: GameState = { ...state, board: { ...state.board, robberHex: hex } };

  const victims = stealTargetsAt(next, ruleSet, hex, thiefId);
  if (victims.length === 0) {
    if (stealFrom !== undefined) illegal("there is nobody to steal from on that hex");
    return next;
  }
  if (stealFrom === undefined) illegal("must choose a player to steal from");
  if (!victims.includes(stealFrom)) illegal(`cannot steal from player ${stealFrom} on that hex`);

  const victim = next.players.find((p) => p.id === stealFrom)!;
  const hand = expandHand(victim.resources);
  const { value: index, state: rngState } = nextInt(next.rngState, hand.length);
  const stolen = hand[index]!;

  next = {
    ...next,
    rngState,
    players: next.players.map((p) => {
      if (p.id === stealFrom) return { ...p, resources: subtractResources(p.resources, { [stolen]: 1 }) };
      if (p.id === thiefId) return { ...p, resources: addResources(p.resources, { [stolen]: 1 }) };
      return p;
    }),
  };

  return next;
}

export function moveRobber(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  hex: HexId,
  stealFrom: number | undefined
): GameState {
  requirePhase(state, "moveRobberAfterSeven");
  requireCurrentPlayer(state, playerId);

  const next = applyRobberMove(state, ruleSet, playerId, hex, stealFrom);
  return refresh({ ...next, turn: { ...next.turn, phase: "mainTurn" } }, ruleSet, playerId);
}
