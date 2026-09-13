// Resource (and, in Cities & Knights, commodity) production on a dice roll,
// and bank trade ratios.

import type { Commodity, GameState, HexTile, Resource, RuleSet } from "@catan/shared";
import { hexVertices } from "../board/geometry.js";
import { getGeometry } from "../geometryCache.js";
import { COMMODITIES, RESOURCES } from "../resources.js";

export interface Production {
  /** playerId -> resources gained. */
  gains: Map<number, Partial<Record<Resource, number>>>;
  /** playerId -> commodities gained (empty unless Cities & Knights is on). */
  commodityGains: Map<number, Partial<Record<Commodity, number>>>;
  /** The banks after paying out. */
  bank: Record<Resource, number>;
  commodityBank: Record<Commodity, number>;
}

/**
 * Pay out one card type from a supply, with the official shortage rule: if
 * the supply can't cover everyone owed it and more than one player is owed,
 * nobody gets any; a lone claimant takes what's left.
 */
function payOut<K extends string>(
  kinds: readonly K[],
  demand: Map<number, Partial<Record<K, number>>>,
  supply: Record<K, number>
): { gains: Map<number, Partial<Record<K, number>>>; supply: Record<K, number> } {
  const left = { ...supply };
  const gains = new Map<number, Partial<Record<K, number>>>();

  for (const kind of kinds) {
    const owed = [...demand.entries()]
      .map(([playerId, counts]) => ({ playerId, amount: counts[kind] ?? 0 }))
      .filter((o) => o.amount > 0);
    if (owed.length === 0) continue;

    const totalOwed = owed.reduce((sum, o) => sum + o.amount, 0);
    if (totalOwed > left[kind]) {
      if (owed.length !== 1) continue;
      const only = owed[0]!;
      const payout = left[kind];
      if (payout <= 0) continue;
      const gain: Partial<Record<K, number>> = gains.get(only.playerId) ?? {};
      gain[kind] = (gain[kind] ?? 0) + payout;
      gains.set(only.playerId, gain);
      left[kind] = 0;
      continue;
    }

    for (const o of owed) {
      const gain: Partial<Record<K, number>> = gains.get(o.playerId) ?? {};
      gain[kind] = (gain[kind] ?? 0) + o.amount;
      gains.set(o.playerId, gain);
    }
    left[kind] -= totalOwed;
  }

  return { gains, supply: left };
}

/** The hex's number token as it stands now (the Inventor may have moved it). */
export function effectiveNumberToken(state: GameState, hex: HexTile): number | null {
  return state.board.tokenOverrides[hex.id] ?? hex.numberToken;
}

/**
 * Who produces what on `roll`. The robber's hex produces nothing. A
 * settlement yields 1 resource; a city yields 2 — or, with Cities & Knights
 * on and the hex mapped to a commodity, 1 resource + 1 commodity.
 */
export function productionForRoll(state: GameState, ruleSet: RuleSet, roll: number): Production {
  const geometry = getGeometry(ruleSet.board);
  const demand = new Map<number, Partial<Record<Resource, number>>>();
  const commodityDemand = new Map<number, Partial<Record<Commodity, number>>>();
  const commodityFor = ruleSet.citiesAndKnights?.commodityFor;

  for (const hex of ruleSet.board.hexes) {
    if (effectiveNumberToken(state, hex) !== roll) continue;
    if (hex.id === state.board.robberHex) continue;
    if (hex.resource === "desert") continue;
    const cube = geometry.hexes.get(hex.id);
    if (!cube) continue;

    for (const vertex of hexVertices(cube)) {
      const building = state.board.buildings[vertex];
      if (!building) continue;

      const commodity = building.kind === "city" ? commodityFor?.[hex.resource] : undefined;
      const resourceAmount = building.kind === "city" && !commodity ? 2 : 1;

      const current = demand.get(building.playerId) ?? {};
      current[hex.resource] = (current[hex.resource] ?? 0) + resourceAmount;
      demand.set(building.playerId, current);

      if (commodity) {
        const cur = commodityDemand.get(building.playerId) ?? {};
        cur[commodity] = (cur[commodity] ?? 0) + 1;
        commodityDemand.set(building.playerId, cur);
      }
    }
  }

  const resources = payOut(RESOURCES, demand, state.bank);
  const commodities = payOut(COMMODITIES, commodityDemand, state.commodityBank);

  return {
    gains: resources.gains,
    bank: resources.supply,
    commodityGains: commodities.gains,
    commodityBank: commodities.supply,
  };
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
  const fleet = state.players.find((p) => p.id === playerId)?.merchantFleet;
  if (fleet && fleet in ratios) ratios[fleet as Resource] = 2;
  // The merchant: its hex's resource trades 2:1 for whoever owns the piece.
  if (state.merchant?.playerId === playerId) {
    const hex = ruleSet.board.hexes.find((h) => h.id === state.merchant!.hex);
    if (hex && hex.resource !== "desert") ratios[hex.resource] = Math.min(ratios[hex.resource], 2);
  }

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

/**
 * Bank-trade ratio for commodities (Cities & Knights): 4:1, a generic port
 * gives 3:1, and the trading house (trade improvement at
 * `commodityPortLevel`) gives 2:1. Resource-specific ports don't apply.
 */
export function commodityTradeRatioFor(
  state: GameState,
  ruleSet: RuleSet,
  playerId: number,
  commodity?: Commodity
): number {
  const ck = ruleSet.citiesAndKnights;
  const player = state.players.find((p) => p.id === playerId);
  if (!ck || !player) return 4;

  let ratio = 4;
  if (commodity && player.merchantFleet === commodity) ratio = 2;
  for (const port of ruleSet.board.ports) {
    if (port.resource !== null) continue;
    if (port.vertexIds.some((v) => state.board.buildings[v]?.playerId === playerId)) {
      ratio = Math.min(ratio, port.ratio);
    }
  }
  if (player.improvements.trade >= ck.commodityPortLevel) ratio = Math.min(ratio, 2);
  return ratio;
}
