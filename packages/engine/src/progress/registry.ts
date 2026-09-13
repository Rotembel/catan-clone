import { POLITICS_CARDS } from "./cards/politics.js";
import { SCIENCE_CARDS } from "./cards/science.js";
import { TRADE_CARDS } from "./cards/trade.js";
import type { ProgressCardImpl } from "./types.js";

/** Every playable progress card the engine knows, by id. VP cards are "immediate" and have no impl. */
export const PROGRESS_CARD_IMPLS: Readonly<Record<string, ProgressCardImpl>> = Object.fromEntries(
  [...TRADE_CARDS, ...POLITICS_CARDS, ...SCIENCE_CARDS].map((c) => [c.id, c])
);

export function progressCardImpl(id: string): ProgressCardImpl | undefined {
  return PROGRESS_CARD_IMPLS[id];
}
