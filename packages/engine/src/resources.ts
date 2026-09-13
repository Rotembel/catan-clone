import type { Resource } from "@catan/shared";

export const RESOURCES: readonly Resource[] = ["wood", "brick", "sheep", "wheat", "ore"];

export function emptyResources(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function totalCards(res: Partial<Record<Resource, number>>): number {
  return RESOURCES.reduce((sum, r) => sum + (res[r] ?? 0), 0);
}

export function canAfford(
  res: Record<Resource, number>,
  cost: Partial<Record<Resource, number>>
): boolean {
  return RESOURCES.every((r) => res[r] >= (cost[r] ?? 0));
}

export function subtractResources(
  res: Record<Resource, number>,
  amount: Partial<Record<Resource, number>>
): Record<Resource, number> {
  const out = { ...res };
  for (const r of RESOURCES) out[r] -= amount[r] ?? 0;
  return out;
}

export function addResources(
  res: Record<Resource, number>,
  amount: Partial<Record<Resource, number>>
): Record<Resource, number> {
  const out = { ...res };
  for (const r of RESOURCES) out[r] += amount[r] ?? 0;
  return out;
}

/** Every resource card in hand, expanded one entry per card — used for random steals. */
export function expandHand(res: Record<Resource, number>): Resource[] {
  const cards: Resource[] = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < res[r]; i++) cards.push(r);
  }
  return cards;
}
