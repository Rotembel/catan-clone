// The trade dialogs' state → TradeOffer mapping, kept pure so the "complete
// selection ⇒ a submittable offer exists" invariant can be unit-tested.
// Legality itself stays with the engine: these only decide whether the
// dialog's primary button is enabled and what it sends.

import type { Card, CardCounts, TradeOffer } from "@catan/shared";

export interface BankSelection {
  give: Card | null;
  receive: Card | null;
}

export interface BankContext {
  held: (c: Card) => number;
  inBank: (c: Card) => number;
  ratio: (c: Card) => number;
}

/** One ratio's worth of `give` for one `receive` — the only shape the dialog offers. */
export function bankOffer(me: number, sel: BankSelection, ctx: BankContext): TradeOffer | undefined {
  if (!sel.give || !sel.receive || sel.give === sel.receive) return undefined;
  if (ctx.held(sel.give) < ctx.ratio(sel.give) || ctx.inBank(sel.receive) < 1) return undefined;
  return { fromPlayerId: me, give: { [sel.give]: ctx.ratio(sel.give) }, receive: { [sel.receive]: 1 } };
}

export interface PlayerSelection {
  to: number | undefined;
  give: CardCounts;
  receive: CardCounts;
  giveDevCards?: string[];
  receiveDevCards?: string[];
}

export function totalOf(counts: CardCounts): number {
  return Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
}

/** A player-to-player offer: needs a counterpart, something given and something asked. */
export function playerOffer(me: number, sel: PlayerSelection): TradeOffer | undefined {
  if (sel.to === undefined || sel.to === me) return undefined;
  const gives = totalOf(sel.give) + (sel.giveDevCards?.length ?? 0);
  const wants = totalOf(sel.receive) + (sel.receiveDevCards?.length ?? 0);
  if (gives === 0 || wants === 0) return undefined;
  const clean = (c: CardCounts): CardCounts => Object.fromEntries(Object.entries(c).filter(([, n]) => (n ?? 0) > 0));
  return {
    fromPlayerId: me,
    toPlayerId: sel.to,
    give: clean(sel.give),
    receive: clean(sel.receive),
    ...(sel.giveDevCards?.length ? { giveDevCards: sel.giveDevCards } : {}),
    ...(sel.receiveDevCards?.length ? { receiveDevCards: sel.receiveDevCards } : {}),
  };
}

/** Short human summary of one side, e.g. "2 🌲, 1 ⛰️" — icons come from the caller. */
export function sideSummary(counts: CardCounts, devCards: string[] | undefined, icon: (c: Card) => string): string {
  const parts = (Object.entries(counts) as [Card, number | undefined][])
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([c, n]) => `${n} ${icon(c)}`);
  if (devCards?.length) parts.push(`${devCards.length} 📜`);
  return parts.length ? parts.join(", ") : "nothing";
}
