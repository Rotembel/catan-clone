import type { Card, CardCounts, Commodity, ImprovementTrack, Player, Resource } from "@catan/shared";

export const RESOURCES: readonly Resource[] = ["wood", "brick", "sheep", "wheat", "ore"];
export const COMMODITIES: readonly Commodity[] = ["cloth", "coin", "paper"];
export const CARDS: readonly Card[] = [...RESOURCES, ...COMMODITIES];
export const IMPROVEMENT_TRACKS: readonly ImprovementTrack[] = ["trade", "politics", "science"];

export function emptyResources(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function emptyCommodities(): Record<Commodity, number> {
  return { cloth: 0, coin: 0, paper: 0 };
}

export function emptyImprovements(): Record<ImprovementTrack, number> {
  return { trade: 0, politics: 0, science: 0 };
}

export function isCommodity(card: Card): card is Commodity {
  return (COMMODITIES as readonly string[]).includes(card);
}

/** Resource cards only (commodity keys, if any, are ignored). */
export function totalCards(res: Partial<Record<Resource, number>>): number {
  return RESOURCES.reduce((sum, r) => sum + (res[r] ?? 0), 0);
}

export function totalCommodities(com: Partial<Record<Commodity, number>>): number {
  return COMMODITIES.reduce((sum, c) => sum + (com[c] ?? 0), 0);
}

/** Every card in a mixed count — what the 7-card limit and steals look at. */
export function totalAllCards(counts: CardCounts): number {
  return CARDS.reduce((sum, c) => sum + (counts[c] ?? 0), 0);
}

/** A player's whole hand: resources + commodities. */
export function handSize(player: Player): number {
  return totalCards(player.resources) + totalCommodities(player.commodities);
}

/** Split a mixed count into its resource and commodity halves. */
export function splitCards(counts: CardCounts): {
  resources: Partial<Record<Resource, number>>;
  commodities: Partial<Record<Commodity, number>>;
} {
  const resources: Partial<Record<Resource, number>> = {};
  const commodities: Partial<Record<Commodity, number>> = {};
  for (const r of RESOURCES) if (counts[r]) resources[r] = counts[r];
  for (const c of COMMODITIES) if (counts[c]) commodities[c] = counts[c];
  return { resources, commodities };
}

export function canAfford(
  res: Record<Resource, number>,
  cost: Partial<Record<Resource, number>>
): boolean {
  return RESOURCES.every((r) => res[r] >= (cost[r] ?? 0));
}

/** Does the player hold every card in a mixed count? */
export function playerHolds(player: Player, counts: CardCounts): boolean {
  const { resources, commodities } = splitCards(counts);
  return (
    canAfford(player.resources, resources) &&
    COMMODITIES.every((c) => player.commodities[c] >= (commodities[c] ?? 0))
  );
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

export function addCommodities(
  com: Record<Commodity, number>,
  amount: Partial<Record<Commodity, number>>
): Record<Commodity, number> {
  const out = { ...com };
  for (const c of COMMODITIES) out[c] += amount[c] ?? 0;
  return out;
}

export function subtractCommodities(
  com: Record<Commodity, number>,
  amount: Partial<Record<Commodity, number>>
): Record<Commodity, number> {
  const out = { ...com };
  for (const c of COMMODITIES) out[c] -= amount[c] ?? 0;
  return out;
}

/** The player with a mixed count added to (or, negated, removed from) their hand. */
export function playerPlus(player: Player, counts: CardCounts): Player {
  const { resources, commodities } = splitCards(counts);
  return {
    ...player,
    resources: addResources(player.resources, resources),
    commodities: addCommodities(player.commodities, commodities),
  };
}

export function playerMinus(player: Player, counts: CardCounts): Player {
  const { resources, commodities } = splitCards(counts);
  return {
    ...player,
    resources: subtractResources(player.resources, resources),
    commodities: subtractCommodities(player.commodities, commodities),
  };
}

/** Every resource card in hand, expanded one entry per card. */
export function expandHand(res: Record<Resource, number>): Resource[] {
  const cards: Resource[] = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < res[r]; i++) cards.push(r);
  }
  return cards;
}

/** Every card in a player's hand, resources then commodities — used for random steals. */
export function expandPlayerHand(player: Player): Card[] {
  const cards: Card[] = [...expandHand(player.resources)];
  for (const c of COMMODITIES) {
    for (let i = 0; i < player.commodities[c]; i++) cards.push(c);
  }
  return cards;
}
