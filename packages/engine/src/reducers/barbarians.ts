// Cities & Knights barbarians: the ship advances on the event die and,
// at the end of its track, attacks. Catan's strength is its *active*
// knights; the barbarians' is the number of cities. Win: the single
// strongest defender becomes Defender of Catan (+1 VP). Lose: the weakest
// player(s) holding cities each lose one — chosen by them if they have
// several. Either way every knight deactivates and the ship returns.
//
// Not in this slice: on a tied defence the official rule hands out
// progress cards (slice 3) — here nobody is awarded. Metropolis immunity
// and city walls arrive with slice 4.

import type { GameState, RuleSet, VertexId } from "@catan/shared";
import { illegal, refresh, requirePhase, requirePlayer } from "./helpers.js";
import { resolveRoll } from "./dice.js";

/** Sum of the player's *active* knights' levels. */
export function knightStrength(state: GameState, playerId: number): number {
  let strength = 0;
  for (const knight of Object.values(state.board.knights)) {
    if (knight?.playerId === playerId && knight.active) strength += knight.level;
  }
  return strength;
}

/** Barbarian strength: one per city on the board. */
export function barbarianStrength(state: GameState): number {
  return Object.values(state.board.buildings).filter((b) => b?.kind === "city").length;
}

export function cityVertices(state: GameState, playerId: number): VertexId[] {
  return Object.entries(state.board.buildings)
    .filter(([, b]) => b?.playerId === playerId && b.kind === "city")
    .map(([v]) => v);
}

function downgrade(state: GameState, vertex: VertexId): GameState {
  const building = state.board.buildings[vertex]!;
  return {
    ...state,
    board: { ...state.board, buildings: { ...state.board.buildings, [vertex]: { ...building, kind: "settlement" } } },
  };
}

/** One step of the ship; an attack when it reaches the end of the track. */
export function advanceBarbarians(state: GameState, ruleSet: RuleSet): GameState {
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return state;
  const position = state.barbarianPosition + 1;
  if (position < ck.barbarianTrackLength) return { ...state, barbarianPosition: position };
  return resolveBarbarianAttack({ ...state, barbarianPosition: position });
}

/**
 * The attack itself, as a pure step: returns the state after the fight,
 * possibly in "barbarianDowngrade" with players still to choose a city.
 * Does not refresh; the caller does.
 */
export function resolveBarbarianAttack(state: GameState): GameState {
  const strengths = state.players.map((p) => ({ playerId: p.id, strength: knightStrength(state, p.id) }));
  const catan = strengths.reduce((s, x) => s + x.strength, 0);
  const barbarians = barbarianStrength(state);

  let next = state;
  const pending: number[] = [];

  if (catan >= barbarians) {
    const max = Math.max(...strengths.map((s) => s.strength));
    const leaders = strengths.filter((s) => s.strength === max && max > 0);
    if (leaders.length === 1) {
      const id = leaders[0]!.playerId;
      next = { ...next, players: next.players.map((p) => (p.id === id ? { ...p, defenderOfCatan: p.defenderOfCatan + 1 } : p)) };
    }
  } else {
    const withCities = strengths.filter((s) => cityVertices(next, s.playerId).length > 0);
    const min = Math.min(...withCities.map((s) => s.strength));
    for (const loser of withCities.filter((s) => s.strength === min)) {
      const cities = cityVertices(next, loser.playerId);
      if (cities.length === 1) next = downgrade(next, cities[0]!);
      else pending.push(loser.playerId);
    }
  }

  // Every knight stands down and the ship sails again.
  const knights: GameState["board"]["knights"] = {};
  for (const [v, k] of Object.entries(next.board.knights)) if (k) knights[v] = { ...k, active: false };
  next = { ...next, barbarianPosition: 0, board: { ...next.board, knights } };

  if (pending.length > 0) {
    next = { ...next, pendingDowngrades: pending, turn: { ...next.turn, phase: "barbarianDowngrade" } };
  }
  return next;
}

export function downgradeCity(state: GameState, ruleSet: RuleSet, playerId: number, vertex: VertexId): GameState {
  requirePhase(state, "barbarianDowngrade");
  requirePlayer(state, playerId);
  const pending = state.pendingDowngrades ?? [];
  if (!pending.includes(playerId)) illegal(`player ${playerId} does not owe a city`);
  if (!cityVertices(state, playerId).includes(vertex)) illegal(`you have no city at ${vertex}`);

  let next = downgrade(state, vertex);
  const remaining = pending.filter((id) => id !== playerId);
  if (remaining.length > 0) return refresh({ ...next, pendingDowngrades: remaining }, ruleSet);

  // Everyone has paid; the roll that triggered the attack now resolves.
  next = { ...next, pendingDowngrades: undefined, turn: { ...next.turn, phase: "rollDice" } };
  return resolveRoll(next, ruleSet);
}
