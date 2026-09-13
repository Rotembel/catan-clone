# Handoff — where the Catan clone stands

Worker note for whoever picks this up next (human or agent). Read `SPEC.md`
for the plan and `CLAUDE.md` for conventions; this file is *status*: what
exists, how it's verified, what's decided, what's next.

Repo: https://github.com/Rotembel/catan-clone (created private; the GitHub
API reported it **public** on 2026-09-13 — not changed by the agent) · local:
`~/Desktop/catan-starter-docs` · `main` is green and pushed as of `d8ec23a`
(C&K slice 1) plus the planning-docs commit after it.

## Phases

| Phase | Status | Commit | Proof |
|---|---|---|---|
| 0 Foundation | done | `006a6c9` | geometry tests, incl. pixel cross-check on the 19-hex board |
| 1 Full base game, local | done | `df784bd` | 77 tests; bot games finish on every seed with invariants checked |
| 2 Real-time multiplayer | done | `4360969` | 8 socket tests; played live in two browser tabs |
| 3 Stability | done | `598acf4` | server killed & restarted mid-game twice; both tabs resumed and play continued |
| 4 House rule #1 (trade dev cards) | done | `9bd4bad` | flag-on/off tests at ruleset, engine, server; live offer of a card |
| 5 Cities & Knights | **slices 1–4 of 5 done** (1: commodities + improvements; 2: event die, barbarians, knights; 3: progress cards; 4: metropolises, city walls, merchant) — only slice 5 (UI polish) remains | `d8ec23a`, `8f4db83`, `15cf23b`, slice-4 commit | 72 engine tests for the expansion + 4 seeded bot games at 13 VP with resource, commodity and progress-card conservation |
| 6 Custom content | not started | — | |

Also done outside the phase list: client server-URL derives from the
page's hostname (LAN play), `.env.example`, `HANDOFF.md`.

**214 tests** across the workspace (engine 143, rulesets 25, client 3,
cli 16, server 27; `@catan/bot` has none of its own). `pnpm typecheck` clean
in all 7 packages.

### Cities & Knights plan (Phase 5, in slices — owner chose "full C&K, in slices")

1. **done** — commodities (cloth/coin/paper from cities on pasture/mountain/forest), the
   commodity bank, city improvements (3 tracks × 5 levels, paid in that track's commodity,
   need a city), trading house (trade lvl 3 → commodities 2:1), commodities in hands/
   discards/steals/trades, second opening placement is a city, 13 VP.
   Data: `RuleSet.citiesAndKnights` block; `Player.commodities/improvements`;
   `GameState.commodityBank`; action `buildImprovement`. `normalizeState` back-fills
   these on records saved before they existed.
2. **done** — event die (data: `eventDie` faces; rolled with the dice via one extra
   `nextInt` draw, so base-game rolls are byte-identical), barbarian track
   (`barbarianTrackLength` 7) and attack (Catan = sum of *active* knight levels vs.
   barbarians = number of cities; win → single strongest defender gets
   `defenderOfCatan` +1 VP; lose → weakest player(s) with cities lose one: automatic
   for a lone city, otherwise phase `barbarianDowngrade` + action `downgradeCity`;
   all knights deactivate, ship returns). Knights as pieces on vertices: `buildKnight`
   (sheep+ore, empty vertex on your road, 2 per level), `activateKnight` (wheat; can't
   move that turn), `promoteKnight` (sheep+ore; level 3 needs politics ≥ `fortressLevel`),
   `moveKnight` (active only, along own roads, not through enemy pieces, deactivates).
   A knight occupies its vertex (no settlement there; distance rule ignores it) and an
   *enemy* knight blocks road extension and breaks longest road (via
   `isVertexBlockedFor`). Attack resolves **before** production; the roll resolves after
   any downgrade choices (`resolveRoll`).
   State: `BoardState.knights`, `GameState.barbarianPosition/eventDie/pendingDowngrades`,
   `Player.defenderOfCatan`, `TurnPhase "barbarianDowngrade"`. `normalizeState` back-fills.
   **Known limitations (slice 2):** tied defence awards nothing (official: progress cards —
   slice 3); no knight displacement (moving onto a weaker enemy knight) and no
   "chase the robber" knight action; downgrading can push a player past 5 settlements
   (no piece-return rule); the C&K rule set still carries the base development deck
   (progress cards replace it in slice 3); no metropolis immunity / city walls (slice 4).
   **Bot limitations:** builds at most one knight and keeps it active; never promotes or
   moves knights; answers a forced downgrade by giving up its lowest-value city. Games
   still finish on every seed tried.
   **Client (minimal for this slice):** knights are drawn on the board (level number,
   dimmed when inactive), the hand panel shows ship position / event die / your knight
   count / Defender awards, and a forced downgrade is answered by clicking one of your
   cities. No UI yet to build/activate/promote/move knights (slice 5) — humans can't
   defend, so barbarians will win in a human-only C&K game.
3. **done** — progress cards. **Architecture:** `packages/engine/src/progress/` —
   `deck.ts` (three independent `ProgressDeck {draw, discard}` piles in
   `GameState.progressDecks`, seeded shuffle at game creation *only when the expansion
   is on*, reshuffle of the discard pile when a draw pile is empty, both empty → no
   card), `draw.ts` (event-die distribution), `registry.ts` + `cards/{trade,politics,
   science}.ts` (one small `ProgressCardImpl { id, options(state, ruleSet, playerId):
   payload[], apply(...) }` per card — *options* is the bounded legal-payload
   enumeration `legalActions` lists, *apply* validates and returns the new state),
   and `reducers/progress.ts` (hand, timing, phase flow). Card *definitions* (id,
   category, count, `timing: mainTurn | beforeRoll | immediate`) are data in
   `citiesAndKnights.progressCards`; the decks contain only implemented cards for now.
   **Event die:** dice are still drawn first and the event die second (one extra
   `nextInt`), so the persisted RNG sequence is unchanged; a city-gate face deals cards
   *before* production (same stash-and-`resolveRoll` pattern as the barbarian
   downgrade). Eligibility: `improvements[track] >= 1 && red <= level + 1` with the red
   die = `dice[0]`; draw order = roller, then seat order. VP cards (`immediate`) resolve
   on draw into `Player.progressVictoryPoints` (public VP) and go to the discard pile.
   **Hand limit** `progressHandLimit` 4: drawing past it enters phase
   `progressDiscard` with `pendingProgressDiscards`; `discardProgressCard` is the only
   legal action for those players; when all are within the limit the stashed roll
   resolves. **Alchemist** stores `alchemistDice`; the next `rollDice` uses them
   (no dice draw that turn; the event die still rolls). **Inventor** writes
   `BoardState.tokenOverrides` — the `RuleSet.board` layout is never mutated;
   `effectiveNumberToken()` is what production, the bot and the client read.
   **Merchant Fleet** sets `Player.merchantFleet` (2:1 for that card in
   `tradeRatiosFor`/`commodityTradeRatioFor`), cleared on `endTurn`.
   **State/actions added:** `Player.progressCards/progressVictoryPoints/merchantFleet`,
   `GameState.progressDecks/pendingProgressDiscards/alchemistDice`,
   `BoardState.tokenOverrides`, `TurnPhase "progressDiscard"`, actions
   `playProgressCard {cardId, payload}` and `discardProgressCard {cardId}`, payload
   types `*Payload` in shared. `normalizeState` back-fills all of it, so base, Home
   Large and slice-1/2 saves load unchanged (tested).
   **Implemented (13):** trade — Resource Monopoly ×4, Trade Monopoly ×2, Merchant
   Fleet ×2; politics — Bishop ×2, Warlord ×2, Spy ×3, Constitution ×1 (VP); science —
   Irrigation ×2, Mining ×2, Road Building ×2, Inventor ×2, Alchemist ×2, Smith ×2,
   Printer ×1 (VP). **Deferred:** Merchant ×6, Commercial Harbor ×2, Master Merchant ×2
   (merchant piece / negotiation — slice 4+), Deserter ×2, Diplomat ×2, Intrigue ×2
   (knight displacement and road removal are not implemented), Saboteur ×2, Wedding ×2
   (multi-player forced responses need a pending-response phase), Medicine ×2, Crane ×2
   (cost modifiers), Engineer ×1 (city walls — slice 4). Adding one = a definition in
   the rule set + one `ProgressCardImpl`; no reducer or type change.
   **Known rules deviations / TODOs:** Spy cannot be played when your hand is full
   (official: take, then discard down); a tied barbarian defence still awards nothing
   (official: progress cards to the tied players — now implementable); the Bishop steals
   from every adjacent opponent with the game RNG (official); deck sizes are the
   official counts of the implemented cards only; progress cards can be played any
   number of times per turn (official has no per-turn cap either, except Alchemist
   before the roll).
   **Bot:** discards the first card when over the limit; plays Irrigation/Mining,
   Warlord, Resource Monopoly (when it nets ≥ 2) and Road Building; holds everything
   else. Never deadlocks (every mandatory phase is enumerated by `legalActions`).
   **Client:** hand with Play buttons where legal; choice-less cards send immediately;
   Bishop and Inventor pick hexes on the board; Spy/monopolies/fleet/Alchemist/Smith use
   a list picker; a modal handles the forced discard; moved tokens render. Verified by
   typecheck and the engine tests only — no live drill this slice.
4. **done** — metropolises, city walls, the merchant, and five previously deferred cards.
   **Metropolises** (`reducers/metropolis.ts`): canonical ownership in
   `GameState.metropolises[track] = { playerId, vertex }` (one per track; the building
   under it stays a plain city; no duplication). Rules as data in
   `citiesAndKnights.metropolis { claimLevel 4, takeLevel 5, victoryPoints 2 }`: reaching
   claimLevel claims an unowned metropolis; reaching takeLevel takes it from a holder
   still below takeLevel; a holder at takeLevel can never lose it. **Ties:** first to
   claimLevel keeps it (a second player at 4 changes nothing); holder at 4 vs challenger
   at 5 → transfer; both at 5 → holder keeps. It must stand on one of your cities: one
   eligible city places automatically, several → phase `metropolisPlacement` with
   `pendingMetropolis` and action `placeMetropolis {vertex}` (nothing else legal), none →
   the claim stays open and lands on the next city you build. Claims are checked after
   `buildImprovement`, `buildCity`, Medicine and Crane. Immune to the barbarians
   (`cityVertices` excludes them; a player whose only cities are metropolises is not at
   risk). +2 VP each, counted in `expansionVictoryPoints` and shown in the public VP.
   **City walls** (`reducers/walls.ts`): `BoardState.walls[vertex] = owner`; action
   `buildWall {vertex}`; data `citiesAndKnights.wall { cost {brick 2}, perPlayer 3,
   discardBonus 2 }`; only on your own cities, one per city. Each wall raises *that
   player's* robber threshold (`discardThresholdFor` = 7 + walls × bonus), used by the 7
   roll and `discardCountFor`; walls are removed when the barbarians downgrade the city.
   No VP. **Merchant** (`GameState.merchant = { hex, playerId }`): placed/moved by the
   Merchant card onto a land hex next to one of your buildings; the owner trades that
   hex's resource 2:1 (`tradeRatiosFor`); +1 VP (`merchantVictoryPoints`); another
   player's card moves it and takes the VP.
   **Cards now implemented (+5 → 18):** Merchant ×6, Master Merchant ×2 (take up to 2
   cards of your choice from a player with more VP — hands are open state here, as
   they are on the wire), Engineer ×1 (free wall), Medicine ×2 (city for 2 ore + 1
   wheat), Crane ×2 (improvement for one commodity less — level 1 becomes free, per the
   official card). **Still deferred (B):** Commercial Harbor, Deserter, Wedding
   (opponent-choice response phases), Diplomat (road removal + re-placement follow-up),
   Intrigue (knight displacement), Saboteur (forced half-hand discard outside the 7
   pipeline). **VP sources audited (no double counting):** settlements 1, cities 2,
   longest road 2, largest army 2, Defender of Catan, progress VP cards, metropolis 2,
   merchant 1 — all public via `refresh`; hidden VP dev cards only in `totalVictoryPoints`;
   the threshold stays `ruleSet.victoryPoints`. Persisted/reloaded state yields identical
   VP (tested). `normalizeState` back-fills `walls`, `metropolises`; older saves load.
   **Bot:** builds a wall when affordable (best city), places a metropolis on its
   best-producing city, plays Medicine/Crane/Engineer/Master Merchant when legal and the
   Merchant on its highest-pip eligible hex. **Client:** metropolis ★ over the city, a
   dashed ring for a wall, an "M" chip on the merchant's hex; wall and metropolis
   placements are board clicks; Engineer/Medicine/Merchant pick on the board,
   Crane/Master Merchant from a list. Verified by typecheck and engine tests only.
   **Deviations / TODOs:** a metropolis transfer with no eligible city waits for the
   next city (official: same); the barbarians never target a player with only
   metropolises (official: they lose nothing — same); Master Merchant lets you see the
   target's hand (official: you look at it — same, since state is open).
5. client UI polish for all of the above (slice 1–4 UIs are functional but plain)

## HOME STABLE v0.1 — built, release candidate for `v0.6.0-home.1` (NOT tagged yet)

Cities & Knights is **paused after slice 2**. The home build is implemented and
passes every automated gate plus a full local restart drill; the **real Wi-Fi
smoke test in `HOME_STABLE_CHECKLIST.md` is the owner's** and gates the tag.

What exists (all in the same commit series):
- **Setup as data** — `RuleSet.setup: SetupRules { sequence: "snake", rounds: SetupRound[],
  startingResourcesRound }`; `GameState.setupRound`. Rounds snake 0..N-1, N-1..0,
  0..N-1…; exactly one (1-based) round pays starting resources. Absent = the classic
  two rounds (C&K's city-as-second-placement flag still drives it). The legacy four phase
  names are kept (round 0 → `…1`, later rounds → `…2`), so nothing downstream changed.
- **Piece limits as data** — `RuleSet.pieceLimits` (`pieceLimitsOf(ruleSet)`); base stays 15/5/4.
- **Radius-scaled base board** — `generateBaseBoardLayout(rng, radius)` now scales the
  resource pool, tokens and ports to the board (it previously left hexes 19+ with
  `undefined` resources at radius 3 — a latent bug, now tested).
- **mapgen-v1** (`packages/rulesets/src/mapgen.ts`) — `generateBoard({seed, radius, seats,
  placementsPerSeat, candidates})`: candidate *i* is the base generator seeded from
  `${seed}|mapgen-v1|${i}`, then a deterministic **repair** that separates touching 6/8
  tokens (a pure shuffle almost never manages it with eight hot tokens), then a pure
  evaluator (6/8 adjacency = reject; same-resource clusters penalised; ≥ seats×placements
  independent viable opening spots required; per-resource pip share). Best total wins,
  ties → lowest index. `RuleSet.mapgen: { seed, generationVersion, candidateIndex, score }`
  travels with the layout; the layout itself is persisted, never regenerated.
- **Preset `home-large-5` — "Home Large — 5 Seats"** (`presets/homeLarge.ts`): base rules,
  radius 3 (37 hexes), 3 settlement rounds paying on the **2nd**, **13 VP (configurable via
  `createRuleSet(id, { victoryPoints })`)**, `maxPlayers: 5`, piece limits 18/7/5
  (provisional — 5 settlements + 4 cities can't reach 13 with three openings).
  Registry entries carry `seats: {min,max}`; the server refuses a start outside that range.
- **`@catan/bot`** — `chooseAction` (moved out of `apps/cli`) and `nextActor(state)`
  (discard → downgrade → trade target → current player), shared by CLI and server.
- **Bot seats** — `Seat.kind: "human" | "bot"`, host-only `addBot`/`removeBot` in the lobby
  (`MAX_PLAYERS` is now 5). `CatanRoom` runs a single re-armed timer: when `nextActor` is a
  bot and ≥1 human is connected, it calls `chooseAction` and pushes the result through the
  **same** `applyEnvelope` → persist → broadcast path as a human intent. Each bot's RNG is
  persisted on its seat (`StoredSeat.botRng`), so a restart replays the same choices; bots
  stay idle until a human reconnects (no ghost games, no duplicate loops).
- **Build identity** — `BuildInfo { appVersion, gitCommit, buildProfile, mapGenerationVersion }`
  read at server start (root `package.json` version = `0.6.0-home.1`, `git rev-parse`,
  `BUILD_PROFILE`), printed at startup, in every `RoomSnapshot` (lobby diagnostics line,
  with the persistence path), and stored in each `GameRecord.build`.
- **Launcher** — `pnpm run home` (`scripts/home.mjs`; plain `pnpm home` is a pnpm
  built-in): checks both ports (clear exit-1 message if taken), starts server + client
  bound to `0.0.0.0`, `CATAN_DATA_DIR=.catan-home-data`, `BUILD_PROFILE=home-lan`, prints
  the LAN URL box and the build line; Ctrl+C stops both process groups (SIGTERM, then
  SIGKILL after 4 s) and nothing else.
- **FileStore hardening** — overlapping saves used to share one temp file and could tear
  the record (found live: bots persisting every ~700 ms while a client left). Writes are
  now serialised per room with unique temp names, and the previous good file is kept as
  `.bak`, which `load` falls back to (loudly) if the main file is unreadable.

Live drill on this machine (2026-09-13, three browser tabs + launcher):
5-seat lobby, 3 humans + 2 bots, Home Large started, humans placed via the UI, bots
placed on their own; `pnpm run home` Ctrl+C'd mid-setup and relaunched; all tabs
reconnected automatically to the identical game (one tab was refreshed while the server
was down and came back too); play continued and the bots completed round 3 on the
restarted server; the record on disk matched. LAN reachability was verified earlier by
`curl` over the LAN IP (the in-app browser blocks non-localhost origins).

**First real Wi-Fi night (2026-09-13, `786c7b5`, LAN IP URL) — game ran; two release
blockers found and fixed:**
1. *Starting resources.* `SetupRules.grantStartingResourcesFromRound` meant "from this
   round onward" and Home Large used 3, so the second settlement paid nothing and the
   third paid. Owner rule: exactly one round pays, the **second**. Field renamed to
   `startingResourcesRound` (1-based, exactly one round); Home Large = 2; base game
   unchanged (derived 2). Tests: base pays from settlement 2; 3-round rules pay once
   on round 2 and nothing on round 3; the grant equals the adjacent producing hexes,
   deserts pay nothing, bank + hands = 95 throughout; the real preset with 5 players.
2. *Seat recovery.* A player whose tab was killed came back, typed name + code, and
   got "already started" — the seat token lived in `sessionStorage` (lost with the
   tab) and the Join form never sent one. Now credentials are kept per room code in
   **`localStorage`** (`catan.sessions`, same origin), Join auto-attaches the stored
   token for a known code (the typed name is display only), and the home screen
   offers **Resume room CODE as Name** / Forget. Server side is unchanged and is the
   only authority: reclaim is by token, humans only, the token maps to exactly one
   seat, a newer connection supersedes the older (`CLOSE_SUPERSEDED`). Tests: name
   alone refused, wrong token refused, a bot's token refused, a token lands only on
   its own seat with a new display name, plus the existing refresh/restart/supersede
   cases. Consequence: two tabs of the *same browser* now share one seat per room
   (one device = one seat); multi-player dev testing needs separate browser profiles.
3. *`.local` gave 403.* Vite's Host guard (`server.allowedHosts`); `.local` is now
   allowed (verified: `.local` 200, LAN IP 200, foreign host still 403). Cross-origin
   token migration (IP ↔ .local) is **not** solved — a seat is per address; hand out
   one address for the night.

**Known limitations (v0.1):**
- The Wi-Fi smoke test with real devices has **not** been run — that is the tag gate.
- 13 VP and the 18/7/5 piece limits are provisional (MAP_GENERATOR_DESIGN.md §11).
- Bots: same simple policy as the CLI — no trading with humans (they decline offers), no
  road/expansion planning beyond "open a settlement spot", setup picks one best vertex
  at a time (no multi-placement plan), no C&K knight strategy. Always legal.
- Bots wait while no human is connected; if the last human leaves mid-game the game
  simply pauses.
- Port placement on the 37-hex coast is even spacing with a cycled type pattern (11
  ports), not an official layout. No islands / custom masks / 61-hex.
- Absent-player rule unchanged (the game waits).
- Client UI is verified manually; only `deriveServerUrl` has unit tests.
- No packaged binary: `pnpm run home` needs Node + pnpm on the host laptop.

## Future workstreams — planning documents (read before starting either)

Two owner-prepared design documents live in `docs/planning/`. They are
**design / future-phase** material: build from them when their phase comes,
don't implement them inside a Cities & Knights slice, and don't couple them
to each other.

- `docs/planning/MAP_GENERATOR_DESIGN.md` — **Procedural Map Generator**:
  deterministic seeded generation (`BoardShapeGenerator` →
  `BoardContentGenerator` → `BoardBalanceEvaluator`), 37-hex then 61-hex
  presets, configurable `SetupRules` (e.g. 3 settlements; later 2
  settlements + 1 city for C&K), 5+ seats; first target 5 seats = 3 humans +
  2 bots. Must emit a normal `BoardLayout` on the existing canonical geometry,
  stay server-authoritative, and be persisted (it already is, as part of the
  `RuleSet` in the room record), never regenerated on reconnect/restart.
- `docs/planning/HOME_LAN_VERSION_WRAP.md` — **Stable Home LAN build**:
  a tagged known-good build, one-command launcher printing the LAN URL,
  dedicated `CATAN_DATA_DIR`, explicit human/bot lobby seats with a
  server-owned `BotController` over the existing `legalActions` bot (never a
  fake browser client), reconnect/restart drills, automated + real multi-device
  Wi-Fi smoke test, release tag independent of `main`.
- `docs/planning/PLANNING_HANDOFF.md` — the owner's ordering: land docs →
  finish/green the active C&K slice → mapgen as its own phase → home-LAN
  wrapper + live bot seats → combine as `Home Large — 5 Seats` → Wi-Fi smoke
  test → tag.

Constraint from the owner: the Home LAN profile consumes a map preset like
any other ruleset/config; mapgen knows nothing about the LAN profile.
Phase 6 direction to preserve alongside these: rule modules, custom/event
decks, procedural maps, themed house-rule presets — none implemented yet.

## Layout

```
packages/shared     types.ts (GameState/Action/RuleSet — the ONE type source), protocol.ts (wire contract)
packages/engine     pure reducer: apply(state, envelope, ruleSet); board geometry; seeded rng; selectors
packages/rulesets   base game as data; variants/friendsNight.ts; registry.ts (RULE_SETS, createRuleSet)
apps/cli            bot-vs-bot harness: pnpm --filter @catan/cli play
apps/server         Colyseus room (CatanRoom.ts) + store.ts (FileStore dev / MemoryStore tests)
apps/client         React + Vite: Home → Lobby → Game (SVG board, dialogs); net.ts is the store/connection
```

Run: `pnpm --filter @catan/server dev` (ws://localhost:2567, persists to
`apps/server/data/`, override `CATAN_DATA_DIR`) and
`pnpm --filter @catan/client dev` (http://localhost:5173, LAN-reachable).
Tests: `pnpm test`. Types: `pnpm typecheck`.

## Load-bearing decisions (don't undo casually)

- **Server-authoritative, engine is pure.** The room stamps every intent with
  the *seat's* playerId (never the client's), runs `apply`, broadcasts the
  resulting `GameState` verbatim as a message. No Colyseus Schema mirror —
  the engine's output is the wire format. Illegal actions throw
  `IllegalActionError` and leave state untouched; `tryApply` is the probe.
- **RNG lives in `GameState.rngState`** and is threaded through every
  randomising reducer. No `Math.random`/`Date.now` in the engine (the
  server picks the seed; the client uses `Math.random` only for room codes).
- **Vertex/edge identity**: canonical ids derived from hex cube coords
  (`v:x,y,z` = sum of the 3 surrounding hexes; `e:hexA|hexB`). The
  corner↔direction mapping is *derived* from pixel geometry at module load,
  not hand-picked. `vertexPixel`/`edgeMidpoint` parse ids back for rendering.
- **Rules are data.** `houseRules.tradeDevCards` is the only flag so far;
  Friends' night = base + that flag. Adding a variant = one registry entry.
- **Persistence**: full record (seats+tokens, ruleset, game) written after
  every applied action, durable-then-broadcast. A room created for a known
  code rehydrates from the store; unknown codes are refused (`create: true`
  only from the host). Empty rooms dispose after 5 min; finished games and
  empty lobbies delete their record on dispose.
- **Seats & reconnection**: a seat token (in `sessionStorage` — refresh
  keeps it, a new tab is a new player) reclaims the seat; a reclaim kicks a
  stale connection with `CLOSE_SUPERSEDED` (4310). Client auto-reconnects
  with backoff and keeps its token through transient failures, including a
  reload while the server is down.
- **Spec-shape additions** (SPEC §4 said "shape, not final"): Action
  `discardCards`; TurnPhase `discard`; GameState `pendingDiscards`,
  `longestRoadPlayerId`, `largestArmyPlayerId`, `setupLastSettlement`;
  Player `devCardsBoughtThisTurn`, `hasPlayedDevCardThisTurn`.

## Decisions taken with the owner

- Absent player whose turn it is: **the game waits** (reconnection brings
  them back). No auto-skip.
- Room codes, no accounts (SPEC §9 default). SVG placeholders. Desktop-first.

## Open / not done

- **Deploy** (SPEC §8: Fly.io/Railway) — needs the owner's account. The
  client already supports `VITE_SERVER_URL` for a remote server; `FileStore`
  works on a single instance; Redis would slot behind the 4-method
  `GameStore` interface for multi-instance.
- Ports are placed evenly around the coast, not at the official positions
  (ratios/types are standard).
- Largest-army/longest-road tie rule is implemented as *state* (holder kept
  until strictly beaten).
- Client has only the `deriveServerUrl` unit test; UI is verified manually.
- Colyseus `maxClients` is set above 4 on purpose (per-seat limit is
  enforced in `onJoin`) so a full room stays listed for `joinOrCreate`.

## Gotchas for the next worker

- `lsof -ti :2567 | xargs kill` also matches the *browser's* end of the
  socket — use `lsof -ti :2567 -sTCP:LISTEN` to kill only the server.
- The in-app browser used for verification blocks non-localhost origins;
  LAN checks were done with unit tests + `curl`.
- Vitest for the server runs in `pool: "threads"` (Colyseus + forked
  workers tangle their IPC).
- `pnpm-workspace.yaml` has `allowBuilds` for esbuild (true) and
  msgpackr-extract (false, optional native accelerator).
