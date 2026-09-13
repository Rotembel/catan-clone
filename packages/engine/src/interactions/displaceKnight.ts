import type { DisplaceKnightResponse, GameState, Knight, VertexId } from "@catan/shared";
import { illegal } from "../reducers/helpers.js";
import { knightReachableVertices } from "../reducers/knights.js";
import { startInteraction, type InteractionModule } from "./queue.js";

/** What a displaced knight looks like while its owner decides where it goes. */
export interface DisplacedKnight {
  knight: Knight;
  from: VertexId;
}

/**
 * Take a knight off `vertex`; its owner chooses a new spot reachable along
 * their roads, or it is removed if there is none. Used by the Intrigue card
 * and by moving a stronger knight onto a weaker one.
 */
export function displaceKnightAt(state: GameState, ruleSet: import("@catan/shared").RuleSet, vertex: VertexId, sourcePlayerId: number, sourceCardId?: string): GameState {
  const knight = state.board.knights[vertex];
  if (!knight) illegal(`no knight at ${vertex}`);
  const knights = { ...state.board.knights };
  delete knights[vertex];
  const next: GameState = { ...state, board: { ...state.board, knights } };
  const destinations = knightReachableVertices(next, ruleSet, knight.playerId, vertex);
  if (destinations.length === 0) return next; // nowhere to go: the knight is lost
  return startInteraction(next, {
    kind: "displaceKnight",
    sourcePlayerId,
    sourceCardId,
    responders: [knight.playerId],
    payload: { knight, from: vertex } satisfies DisplacedKnight,
  });
}

export const displaceKnight: InteractionModule = {
  options(state, ruleSet, responderId, interaction) {
    const { from } = interaction.payload as DisplacedKnight;
    return knightReachableVertices(state, ruleSet, responderId, from).map((vertex) => ({ vertex }));
  },
  respond(state, ruleSet, responderId, interaction, payload) {
    const { vertex } = (payload ?? {}) as DisplaceKnightResponse;
    const { knight, from } = interaction.payload as DisplacedKnight;
    if (knight.playerId !== responderId) illegal("that is not your knight");
    if (!knightReachableVertices(state, ruleSet, responderId, from).includes(vertex)) illegal(`the knight cannot reach ${vertex} along your roads`);
    return { ...state, board: { ...state.board, knights: { ...state.board.knights, [vertex]: knight } } };
  },
};
