// Resource production on a dice roll, and port trade ratios.

import type { GameState, Resource, RuleSet } from "@catan/shared";
import { hexVertices } from "../board/geometry.js";
import { getGeometry } from "../geometryCache.js";
import { RESOURCES } from "../resources.js";

export interface Production {
  /** playerId -> resources gained. */
  gains: Map<number, Partial<Record<Resource, number>>>;
  /** The bank after paying out. */
  bank: Record<Resource, number>;
}

/**
 * Who produces what on `roll`. The robber's hex produces nothing.
 *
 * Bank shortage follows the official rule: if the bank can't pay everyone
 * owed a given resource, and more than one player is owed it, nobody gets
 * that resource. If exactly one player is owed it, they take what's left.
 */
export function productionForRoll(state: GameState, ruleSet: RuleSet, roll: number): Production {
  const geometry = getGeometry(ruleSet.board);
  const demand = new Map<number, Partial<Record<Resource, number>>>();

  for (const hex of ruleSet.board.hexes) {
    if (hex.numberToken !== roll) continue;
    if (hex.id === state.board.robberHex) continue;
    if (hex.resource === "desert") continue;
    const cube = geometry.hexes.get(hex.id);
    if (!cube) continue;

    for (const vertex of hexVertices(cube)) {
      const building = state.board.buildings[vertex];
      if (!building) continue;
      const amount = building.kind === "city" ? 2 : 1;
      const current = demand.get(building.playerId) ?? {};
      current[hex.resource] = (current[hex.resource] ?? 0) + amount;
      demand.set(building.playerId, current);
    }
  }

  const bank = { ...state.bank };
  const gains = new Map<number, Partial<Record<Resource, number>>>();

  for (const resource of RESOURCES) {
    const owed = [...demand.entries()]
      .map(([playerId, res]) => ({ playerId, amount: res[resource] ?? 0 }))
      .filter((o) => o.amount > 0);
    if (owed.length === 0) continue;

    const totalOwed = owed.reduce((sum, o) => sum + o.amount, 0);
    if (totalOwed > bank[resource]) {
      // Not enough to go around: one claimant takes the remainder, several
      // claimants means nobody gets any.
      if (owed.length !== 1) continue;
      const only = owed[0]!;
      const payout = bank[resource];
      if (payout <= 0) continue;
      const gain = gains.get(only.playerId) ?? {};
      gain[resource] = (gain[resource] ?? 0) + payout;
      gains.set(only.playerId, gain);
      bank[resource] = 0;
      continue;
    }

    for (const o of owed) {
      const gain = gains.get(o.playerId) ?? {};
      gain[resource] = (gain[resource] ?? 0) + o.amount;
      gains.set(o.playerId, gain);
    }
    bank[resource] -= totalOwed;
  }

  return { gains, bank };
}

/**
 * The best bank-trade ratio this player can get for each resource: 4:1 by
 * default, 3:1 at a generic port, 2:1 at that resource's own port — and
 * only if they have a building on one of the port's vertices.
 */
export function tradeRatiosFor(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number
): Record<Resource, number> {
  const ratios: Record<Resource, number> = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };

  for (const port of ruleSet.board.ports) {
    const owns = port.vertexIds.some((v) => state.board.buildings[v]?.playerId === playerId);
    if (!owns) continue;
    if (port.resource === null) {
      for (const r of RESOURCES) ratios[r] = Math.min(ratios[r], port.ratio);
    } else {
      ratios[port.resource] = Math.min(ratios[port.resource], port.ratio);
    }
  }

  return ratios;
}
