import type { GameState, Player, Resource, RuleSet } from "@catan/shared";
import { emptyCommodities, emptyImprovements, emptyResources } from "./resources.js";
import { shuffle, type RngState } from "./rng.js";

export interface CreateGameOptions {
  playerNames: string[];
  /** RNG state to continue from — typically the one the RuleSet builder returned. */
  rngState: RngState;
  /** How many of each resource the bank holds. Standard base game: 19. */
  bankPerResource?: number;
}

/** The full dev deck as a flat list of card ids, one entry per physical card. */
export function buildDevDeck(ruleSet: RuleSet): string[] {
  const deck: string[] = [];
  for (const def of ruleSet.devCards) {
    for (let i = 0; i < def.count; i++) deck.push(def.id);
  }
  return deck;
}

export function createPlayer(id: number, name: string): Player {
  return {
    id,
    name,
    resources: emptyResources(),
    devCards: [],
    devCardsBoughtThisTurn: [],
    hasPlayedDevCardThisTurn: false,
    playedKnights: 0,
    victoryPoints: 0,
    commodities: emptyCommodities(),
    improvements: emptyImprovements(),
    defenderOfCatan: 0,
  };
}

/**
 * Fill in fields a persisted state from an older build may lack, so a
 * record saved before an expansion existed still loads. Idempotent.
 */
export function normalizeState(state: GameState): GameState {
  return {
    ...state,
    commodityBank: { ...emptyCommodities(), ...(state.commodityBank ?? {}) },
    barbarianPosition: state.barbarianPosition ?? 0,
    board: { ...state.board, knights: state.board.knights ?? {} },
    players: state.players.map((p) => ({
      ...p,
      commodities: { ...emptyCommodities(), ...(p.commodities ?? {}) },
      improvements: { ...emptyImprovements(), ...(p.improvements ?? {}) },
      defenderOfCatan: p.defenderOfCatan ?? 0,
    })),
  };
}

/** A fresh game, sitting at the first player's first setup settlement. */
export function createInitialState(ruleSet: RuleSet, options: CreateGameOptions): GameState {
  if (options.playerNames.length < 2) {
    throw new Error("a game needs at least 2 players");
  }

  const { result: devDeck, state: rngAfterDeck } = shuffle(buildDevDeck(ruleSet), options.rngState);

  const desert = ruleSet.board.hexes.find((h) => h.resource === "desert");
  const robberHex = desert?.id ?? ruleSet.board.hexes[0]!.id;

  const bankPerResource = options.bankPerResource ?? 19;
  const bank = emptyResources();
  for (const r of Object.keys(bank) as Resource[]) bank[r] = bankPerResource;

  const commodityBank = emptyCommodities();
  const perCommodity = ruleSet.citiesAndKnights?.commodityBankPerType ?? 0;
  for (const c of Object.keys(commodityBank) as (keyof typeof commodityBank)[]) commodityBank[c] = perCommodity;

  return {
    ruleSetId: ruleSet.id,
    players: options.playerNames.map((name, i) => createPlayer(i, name)),
    turn: { current: 0, phase: "setupSettlement1" },
    board: {
      buildings: {},
      roads: {},
      robberHex,
      knights: {},
    },
    devDeck,
    bank,
    commodityBank,
    barbarianPosition: 0,
    rngState: rngAfterDeck,
  };
}
