import type { DeserterChooseResponse, DeserterPlaceResponse, GameState, KnightLevel } from "@catan/shared";
import { illegal } from "../reducers/helpers.js";
import { knightCounts, legalKnightVertices } from "../reducers/knights.js";
import { startInteraction, type InteractionModule } from "./queue.js";

function ownKnights(state: GameState, playerId: number): string[] {
  return Object.entries(state.board.knights).filter(([, k]) => k?.playerId === playerId).map(([v]) => v);
}

/** The Deserter's target picks which of their knights deserts. */
export const deserterChoose: InteractionModule = {
  options: (state, _ruleSet, responderId) => ownKnights(state, responderId).map((vertex) => ({ vertex })),
  respond(state, ruleSet, responderId, interaction, payload) {
    const { vertex } = (payload ?? {}) as DeserterChooseResponse;
    const knight = state.board.knights[vertex];
    if (!knight || knight.playerId !== responderId) illegal(`you have no knight at ${vertex}`);
    const knights = { ...state.board.knights };
    delete knights[vertex];
    let next: GameState = { ...state, board: { ...state.board, knights } };
    // The source may place a knight of the same strength on their own network,
    // if they have such a piece left and somewhere to put it.
    const source = interaction.sourcePlayerId;
    const ck = ruleSet.citiesAndKnights!;
    const canPlace = knightCounts(next, source)[knight.level] < ck.knightsPerLevel && legalKnightVertices(next, ruleSet, source).length > 0;
    if (!canPlace) return next;
    next = { ...next, pendingInteraction: undefined };
    return startInteraction(next, {
      kind: "deserterPlace",
      sourcePlayerId: source,
      sourceCardId: interaction.sourceCardId,
      responders: [source],
      payload: { level: knight.level },
      returnPhase: interaction.returnPhase,
    });
  },
};

/** The source places the deserted knight (inactive) next to one of their roads — or declines. */
export const deserterPlace: InteractionModule = {
  options: (state, ruleSet, responderId) => [...legalKnightVertices(state, ruleSet, responderId).map((vertex) => ({ vertex })), {}],
  respond(state, ruleSet, responderId, interaction, payload) {
    const { vertex } = (payload ?? {}) as DeserterPlaceResponse;
    if (!vertex) return state;
    const { level } = interaction.payload as { level: KnightLevel };
    if (!legalKnightVertices(state, ruleSet, responderId).includes(vertex)) illegal(`a knight must stand on an empty intersection next to one of your roads (${vertex})`);
    if (knightCounts(state, responderId)[level] >= ruleSet.citiesAndKnights!.knightsPerLevel) illegal("you have no knight of that strength left");
    return { ...state, board: { ...state.board, knights: { ...state.board.knights, [vertex]: { playerId: responderId, level, active: false, activatedThisTurn: false } } } };
  },
};
