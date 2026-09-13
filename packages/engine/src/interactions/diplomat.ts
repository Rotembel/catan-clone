import type { DiplomatReplaceResponse } from "@catan/shared";
import { placeFreeRoad } from "../reducers/build.js";
import { legalRoadEdges } from "../selectors/building.js";
import type { InteractionModule } from "./queue.js";

/** After removing your own road with the Diplomat, put it somewhere legal — or not. */
export const diplomatReplace: InteractionModule = {
  options: (state, ruleSet, responderId) => [...legalRoadEdges(state, ruleSet, responderId).map((edge) => ({ edge })), {}],
  respond(state, ruleSet, responderId, _interaction, payload) {
    const { edge } = (payload ?? {}) as DiplomatReplaceResponse;
    if (!edge) return state;
    return placeFreeRoad(state, ruleSet, responderId, edge);
  },
};
