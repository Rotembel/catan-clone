# Catan Clone — Build Spec

> Handoff spec for an AI coding agent (Claude Code). Read this fully before writing code.
> Goal: a **stable, real-time online** Catan replacement, architected so that "house rules"
> are **configuration**, not code rewrites.

---

## 0. Product goals (in priority order)

1. **Stability first.** A dropped connection or a server restart must never kill a game. This is the whole reason the project exists — the existing app (Catan Universe) crashes.
2. **Real-time online multiplayer.** Each player on their own device; server holds the authoritative game.
3. **House rules as data.** First house rule to support: **trading development cards between players**. Later: new cards, renamed cards, larger/extra maps.
4. Base game must be feature-complete and correct before any house rule is added.

Non-goals for v1: AI opponents, matchmaking, accounts/ranking, mobile-native apps.

---

## 1. Non-negotiable architectural principles

These are the load-bearing decisions. Do not deviate without flagging.

- **Server-authoritative.** The server is the single source of truth for game state. Clients send *intents* (actions); the server validates, applies, persists, and broadcasts. Clients never mutate authoritative state directly.
- **Pure, deterministic engine.** The core is a pure reducer: `apply(state, action, ruleSet) -> newState`. No `Date.now()`, no `Math.random()` inside it — randomness (dice, dev-card deck shuffle) is injected as a seeded RNG passed in the action context. Same inputs → same output, always. This makes it unit-testable and replayable.
- **Data-driven rules.** The engine reads game parameters from a `RuleSet` object. The base game is one `RuleSet`; house rules are variations on it, mostly via feature flags and data tables. Avoid hardcoding costs, counts, VP targets, board layout, or card definitions in engine logic.
- **Shared types.** Engine types (`GameState`, `Action`, `RuleSet`) live in a shared package imported by both server and client. One definition, no drift.
- **The client is a renderer.** It draws state and emits actions. It may run a copy of the engine purely for optimistic UI / client-side validation hints, but the server always has the final word.

---

## 2. Tech stack (pinned)

| Concern        | Choice                     | Notes |
|----------------|----------------------------|-------|
| Language       | TypeScript (strict)        | all packages |
| Monorepo       | pnpm workspaces            | keeps engine/shared/server/client together |
| Engine         | plain TS, zero deps        | pure functions only |
| Server         | Node + **Colyseus**        | authoritative rooms, state sync, reconnection built in |
| Client         | React + Vite               | |
| Board render   | SVG (or Canvas if perf demands) | hex grid, vertices, edges |
| Persistence    | Redis (prod) / SQLite (dev) | snapshot game state after every applied action |
| Hosting        | Fly.io or Railway          | free-tier `*.fly.dev` URL is fine; no domain needed |
| Testing        | Vitest                     | engine gets heavy unit-test coverage |

If a dependency isn't listed here, prefer not adding it. Ask before introducing a new runtime dep.

---

## 3. Repo structure

```
catan/
  package.json            # pnpm workspace root
  pnpm-workspace.yaml
  packages/
    shared/               # types shared by everyone
      src/types.ts        # GameState, Action, RuleSet, Player, etc.
      src/index.ts
    engine/               # the pure reducer + rule logic
      src/apply.ts        # apply(state, action, ruleSet) -> newState
      src/reducers/       # one file per action family
      src/board/          # hex geometry: coords, vertices, edges, adjacency
      src/rng.ts          # seeded RNG
      test/               # Vitest specs — the safety net
    rulesets/             # data files: base game, expansions, house-rule variants
      base.ts
      cities-and-knights.ts
      variants/friends-night.ts
  apps/
    server/               # Colyseus rooms wrapping the engine
      src/CatanRoom.ts
      src/persistence.ts
    client/               # React + Vite
      src/
```

---

## 4. Core types (shape, not final)

```ts
// packages/shared/src/types.ts

export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

export interface RuleSet {
  id: string;
  victoryPoints: number;                       // 10 in base
  costs: Record<BuildKind, Partial<Record<Resource, number>>>;
  devCards: DevCardDef[];                       // deck composition + effects
  board: BoardLayout;                           // hex layout, number tokens, ports
  houseRules: HouseRules;
}

export interface HouseRules {
  tradeDevCards: boolean;                       // HOUSE RULE #1 — default false in base
  // future flags go here, each defaulting to the base-game value
}

export interface DevCardDef {
  id: string;                                   // "knight", "monopoly", ...
  label: string;                                // display name — rename by editing this
  count: number;                                // how many in the deck
  kind: "knight" | "victoryPoint" | "progress";
  // effect handling keyed by id in the engine
}

export interface GameState {
  ruleSetId: string;
  players: Player[];
  turn: { current: number; phase: TurnPhase };
  board: BoardState;                            // buildings on vertices, roads on edges, robber
  devDeck: string[];                            // remaining card ids (seeded-shuffled)
  bank: Record<Resource, number>;
  dice?: [number, number];
  pendingTrade?: TradeOffer;
  winner?: number;
  rngState: string;                             // serialized seeded RNG — keeps engine pure
}

export type Action =
  | { type: "rollDice" }
  | { type: "buildRoad"; edge: EdgeId }
  | { type: "buildSettlement"; vertex: VertexId }
  | { type: "buildCity"; vertex: VertexId }
  | { type: "buyDevCard" }
  | { type: "playDevCard"; cardId: string; payload?: unknown }
  | { type: "proposeTrade"; offer: TradeOffer }
  | { type: "respondTrade"; accept: boolean }
  | { type: "moveRobber"; hex: HexId; stealFrom?: number }
  | { type: "endTurn" };
// every action carries { playerId } in its envelope at the server boundary
```

`TradeOffer` must be able to describe **both** resources and dev cards, even though the base
game blocks dev-card trades. The engine gates it on `ruleSet.houseRules.tradeDevCards`.

---

## 5. Board geometry (the part that's easy to get wrong)

- Represent hexes with **axial coordinates** `(q, r)`. Adding an outer ring = a bigger map.
- **Vertices** (settlement/city spots) and **edges** (road spots) are *derived* from hexes with one **canonical addressing scheme**, so a corner shared by three hexes has exactly **one** id. Get this right early; most Catan-clone bugs (double-building, wrong adjacency, bad distance rule) come from inconsistent vertex/edge identity.
- Precompute adjacency maps: vertex↔vertex, vertex↔edge, vertex↔hex, edge↔edge. The distance rule ("no settlement adjacent to another") and road connectivity all read from these.
- `BoardLayout` (in a RuleSet) is pure data: hex list, resource per hex, number token per hex, port positions. A new/larger map is a new layout file.

Write geometry unit tests before building on top of it.

---

## 6. Testing requirements

The engine is where correctness lives, so it carries the tests:

- Unit-test each reducer: legal actions succeed, illegal ones are rejected without mutating state.
- Test the tricky rules explicitly: distance rule, longest road, largest army, robber steal, bank/port trade ratios, dev-card deck depletion, victory detection.
- Determinism test: apply the same action log to the same seed twice → identical state.
- Aim to reach "a full base game can be played to victory via the engine" before touching the network layer.

---

## 7. Phased plan (execute in order; commit per phase)

Each phase should end green (tests pass) and be committed before the next begins.

### Phase 0 — Foundation
- `git init`, a private GitHub repo as the remote, `.gitignore` in place, initial commit (see §8).
- pnpm monorepo, TS strict, Vitest wired.
- `shared/types.ts` with the types above.
- Board geometry in `engine/board/` + geometry tests.
- **Done when:** `pnpm test` runs and geometry tests pass, and the foundation is committed & pushed. No gameplay yet.

### Phase 1 — Full base game, local
- Implement every reducer and the base `RuleSet`.
- A minimal local harness (pass-and-play in one client, or a CLI) that plays a full game to victory.
- **Done when:** a base game is fully playable and rule tests pass. This is the correctness milestone.

### Phase 2 — Real-time multiplayer
- `CatanRoom` (Colyseus) wraps the engine: receive action → validate `playerId` + legality → `apply` → broadcast new state.
- Client connects, creates/joins a room, renders state, sends actions.
- **Done when:** friends on different devices can play a full game online.

### Phase 3 — Stability (the real goal)
- Persist game state after every applied action (Redis/SQLite).
- On server restart, rooms rehydrate from persistence.
- Reconnection: a dropped player rejoins and receives exact current state; game continues for others meanwhile.
- Handle edge cases: player leaves mid-turn, refresh, duplicate connection.
- **Done when:** killing the server or a client mid-game does not lose the game.

### Phase 4 — House rule #1: trade dev cards
- Flip `houseRules.tradeDevCards` in a variant RuleSet.
- Extend `proposeTrade`/`respondTrade` to allow dev cards in the offer when the flag is on.
- Client UI: include dev cards in a trade proposal.
- **Done when:** in a `tradeDevCards: true` game, players can trade dev cards; in base, they can't.

### Phase 5 — Cities & Knights expansion
- New RuleSet extending base: event die, barbarians, progress cards, city improvements/levels.
- **Done when:** a full C&K game is playable online.

### Phase 6 — Custom content
- Simple content editor or config files for: new dev cards (id/label/count/effect), renamed cards (edit `label`), larger/extra maps (new `BoardLayout`).
- **Done when:** a non-programmer can define a variant.

---

## 8. Git & GitHub

Use Git from Phase 0 — it's the safety net that makes letting an agent write code safe, and it's how the phased "commit per green checkpoint" workflow actually lives somewhere.

- **Repo:** one private GitHub repo (free). `git init` locally, add it as `origin`, push from the start.
- **Commit cadence:** every green phase (and every meaningful sub-step) = a commit. If a change breaks the game, `git revert` / checkout the last good commit — don't debug forward blindly.
- **Branches:** `main` stays working and deployable. New features — especially each house rule — get a branch (e.g. `feature/trade-dev-cards`), merged into `main` only when tests are green. For solo work, committing straight to `main` is also fine; branch when a change is risky or long.
- **Commit messages:** imperative and scoped — `engine: add longest-road computation`, `server: persist state on each action`.
- **Deploy from GitHub:** Fly.io / Railway connect to the repo and auto-deploy on push — set this up around Phase 2–3 so shipping is one `git push`.
- **`.gitignore`:** commit the provided `.gitignore` first thing. Never commit `node_modules/`, build output, `.env` / secrets, or local DB files.
- **Claude Code + git:** CC can stage, commit, and (with the `gh` CLI installed) open PRs and manage branches. Let it commit at each checkpoint; you review the diff.

## 9. Open decisions (recommended defaults — confirm or override)

- **Art/assets:** start with simple self-drawn SVG (fast, clean, fully yours). Upgrade visuals later. *Default: SVG placeholders.*
- **Auth vs room-code:** skip accounts for v1 — "create room → share code → join." Much less infrastructure. *Default: room codes.*
- **Mobile:** design the board responsive from the start so phones work, but optimize for desktop first. *Default: responsive, desktop-first.*

---

## 10. How to work economically with Claude Code

- Work **one phase at a time**; commit at each green checkpoint. Small, verifiable steps beat one giant generation.
- Let the **engine tests** be the contract — they catch regressions cheaply so you don't re-explain rules.
- Keep this spec in the repo (e.g. `SPEC.md`) and a short `CLAUDE.md` with conventions, so the agent has context without re-deriving it each session.
- Prefer editing files in place over regenerating whole files.

---

## 11. Legal note

Game *mechanics* are not copyrightable — implementing Catan's rules is fine. The name "Catan",
its artwork, and specific card names/branding are protected. Use your own name, your own art,
and your own card names (which you want anyway). Keep it a private game with friends.
