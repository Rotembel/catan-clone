// The bounded response system (slice 5). A card that needs another player's
// answer calls startInteraction(); the responder answers with
// respondInteraction; each kind is a small module here. No closures, no
// scripting: state carries kind + payload, the module carries the code.

import type { PendingInteraction } from "@catan/shared";
import { commercialHarbor } from "./commercialHarbor.js";
import { deserterChoose, deserterPlace } from "./deserter.js";
import { diplomatReplace } from "./diplomat.js";
import { displaceKnight } from "./displaceKnight.js";
import type { InteractionModule } from "./queue.js";
import { wedding } from "./wedding.js";

export { startInteraction, advanceInteraction, type InteractionModule } from "./queue.js";

export const INTERACTIONS: Readonly<Record<PendingInteraction["kind"], InteractionModule>> = {
  commercialHarbor,
  wedding,
  deserterChoose,
  deserterPlace,
  diplomatReplace,
  displaceKnight,
};
