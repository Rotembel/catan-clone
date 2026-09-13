// Progress decks: three independent piles, seeded shuffles, reshuffle of the
// discard pile when a draw pile runs dry. Pure; the RNG state threads through.

import type { GameState, ImprovementTrack, ProgressDeck, RuleSet } from "@catan/shared";
import { IMPROVEMENT_TRACKS } from "../resources.js";
import { shuffle, type RngState } from "../rng.js";

export function emptyProgressDecks(): Record<ImprovementTrack, ProgressDeck> {
  return { trade: { draw: [], discard: [] }, politics: { draw: [], discard: [] }, science: { draw: [], discard: [] } };
}

/** Build and shuffle all three decks from the rule set; consumes RNG only when the expansion is on. */
export function createProgressDecks(
  ruleSet: RuleSet,
  rngState: RngState
): { decks: Record<ImprovementTrack, ProgressDeck>; state: RngState } {
  const decks = emptyProgressDecks();
  const ck = ruleSet.citiesAndKnights;
  if (!ck) return { decks, state: rngState };
  let state = rngState;
  for (const track of IMPROVEMENT_TRACKS) {
    const cards: string[] = [];
    for (const def of ck.progressCards) {
      if (def.category !== track) continue;
      for (let i = 0; i < def.count; i++) cards.push(def.id);
    }
    const shuffled = shuffle(cards, state);
    decks[track] = { draw: shuffled.result, discard: [] };
    state = shuffled.state;
  }
  return { decks, state };
}

/**
 * Draw the top card of a category. An empty draw pile is refilled by
 * shuffling its discard pile; if both are empty there is no card.
 */
export function drawProgressCard(
  state: GameState,
  track: ImprovementTrack
): { card: string | undefined; state: GameState } {
  let deck = state.progressDecks[track];
  let rngState = state.rngState;
  if (deck.draw.length === 0 && deck.discard.length > 0) {
    const reshuffled = shuffle(deck.discard, rngState);
    deck = { draw: reshuffled.result, discard: [] };
    rngState = reshuffled.state;
  }
  if (deck.draw.length === 0) {
    return { card: undefined, state: { ...state, rngState, progressDecks: { ...state.progressDecks, [track]: deck } } };
  }
  const [card, ...rest] = deck.draw;
  return {
    card,
    state: { ...state, rngState, progressDecks: { ...state.progressDecks, [track]: { ...deck, draw: rest } } },
  };
}

export function discardProgressCardToPile(state: GameState, track: ImprovementTrack, cardId: string): GameState {
  const deck = state.progressDecks[track];
  return { ...state, progressDecks: { ...state.progressDecks, [track]: { ...deck, discard: [...deck.discard, cardId] } } };
}

export function progressCardDef(ruleSet: RuleSet, cardId: string) {
  return ruleSet.citiesAndKnights?.progressCards.find((d) => d.id === cardId);
}
