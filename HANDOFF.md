# Handoff — where the Catan clone stands

Worker note for whoever picks this up next (human or agent). Read `SPEC.md`
for the plan and `CLAUDE.md` for conventions; this file is *status*: what
exists, how it's verified, what's decided, what's next.

Repo: https://github.com/Rotembel/catan-clone (created private; the GitHub
API reported it **public** on 2026-09-13 — not changed by the agent) · local:
`~/Desktop/catan-starter-docs` · `main` is green and pushed as of the iPad playtest round 2
(stuck trade + bot pacing) plus the docs commit after it.

## Phases

| Phase | Status | Commit | Proof |
|---|---|---|---|
| 0 Foundation | done | `006a6c9` | geometry tests, incl. pixel cross-check on the 19-hex board |
| 1 Full base game, local | done | `df784bd` | 77 tests; bot games finish on every seed with invariants checked |
| 2 Real-time multiplayer | done | `4360969` | 8 socket tests; played live in two browser tabs |
| 3 Stability | done | `598acf4` | server killed & restarted mid-game twice; both tabs resumed and play continued |
| 4 House rule #1 (trade dev cards) | done | `9bd4bad` | flag-on/off tests at ruleset, engine, server; live offer of a card |
| 5 Cities & Knights | **COMPLETE** — all 5 slices (1: commodities + improvements; 2: event die, barbarians, knights; 3: progress cards; 4: metropolises, city walls, merchant; 5: response phases, the last six cards, knight displacement, forced discards, human-playable client) | `d8ec23a`, `8f4db83`, `15cf23b`, `c5e94f6`, `5a15a35` | 82 engine tests for the expansion + seeded bot games at 13 VP with conservation invariants + a live two-human/two-bot browser drill (see slice 5) |
| 6 Custom content | not started | — | |

Also done outside the phase list: client server-URL derives from the
page's hostname (LAN play), `.env.example`, `HANDOFF.md`.

**245 tests** across the workspace (engine 153, rulesets 25, client 16,
cli 16, server 35; `@catan/bot` has none of its own). `pnpm typecheck` clean
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
5. **done** — the human-playability layer. **Verdict: CITIES & KNIGHTS PHASE 5
   COMPLETE** — every mandatory action the engine can demand of a player has a
   client path (audited: `legalActions` action types vs. `Game.tsx` handlers), all
   24 official progress cards are in the decks, and bots answer every prompt.
   **Response-phase architecture** (`packages/engine/src/interactions/`): a card
   or effect that needs *other* players' decisions calls `startInteraction(state,
   {kind, sourcePlayerId, sourceCardId?, responders, payload})`. That writes
   `GameState.pendingInteraction { kind, sourcePlayerId, sourceCardId, responders,
   currentResponder, payload, returnPhase }` and sets `turn.phase = "respond"`.
   Exactly one responder acts at a time; the only legal action for them is
   `respondInteraction {payload}`, whose bounded payloads come from the module's
   `options(state, ruleSet, playerId)` (`interactionOptions` is what
   `legalActions`, the bot and the client all read). The module's `respond(...)`
   applies the answer, then `advanceInteraction` moves to the next responder or
   restores `returnPhase`. Everything lives in plain state (no closures), so a
   response survives persistence, reconnect, server restart and bot seats
   (`nextActor` returns `currentResponder`). Chaining is allowed: a response may
   start a follow-up interaction (Deserter choose → Deserter place); the
   follow-up's `returnPhase` inherits the original one. Modules in
   `interactions/index.ts`: `commercialHarbor`, `wedding`, `deserterChoose`,
   `deserterPlace`, `diplomatReplace`, `displaceKnight`. `queue.ts` holds
   start/advance; modules and cards import only `queue.ts` (an earlier circular
   import through `index.ts` left a registry entry undefined — keep it that way).
   **Forced discards** (`GameState.discardRequests: DiscardRequest[] { playerId,
   count, reason, sourcePlayerId?, sourceCardId?, returnPhase }`, `TurnPhase
   "forcedDiscard"`, `requestDiscards(...)`): the existing `discardCards` action
   serves both the 7 roll (phase `discard`, threshold-based) and forced requests
   (phase `forcedDiscard`, exact count); `discardCountFor(state, playerId, ruleSet)`
   reads whichever applies, so the client dialog is one component titled by the
   reason ("Saboteur! discard 3 cards"). Never silent.
   **Knight displacement** (`reducers/knights.ts` + `interactions/displaceKnight.ts`):
   `knightMoveTargets(state, ruleSet, playerId, from, level) → { free, displace }`;
   `moveKnight` onto a strictly weaker *active-or-not* enemy knight (mover must be
   stronger) removes it, and its owner gets a `displaceKnight` response to re-place
   it on a vertex reachable along their roads (`knightReachableVertices`); with
   nothing reachable the knight is lost. Intrigue uses the same path.
   **Cards implemented this slice (+6 → 24 = the full official deck):**
   Commercial Harbor ×2 (every other player with commodities must give one
   commodity of their choice for one of your resources you pick per player — a
   response per opponent), Wedding ×2 (each player with more VP gives 2 cards of
   their choice, or their whole hand if smaller), Saboteur ×2 (each player with ≥
   your VP discards half, rounded down — forced-discard phase), Deserter ×2 (pick an
   opponent; *they* choose which of their knights to remove; you place a knight of
   the same level, inactive, on a free vertex on your roads — or decline if none),
   Diplomat ×2 (remove any *open* road — one with a free end not touching another
   road/building of its owner — your own may be re-placed via a response, others'
   are just gone; longest road is recomputed), Intrigue ×2 (displace an enemy knight
   standing on one of your roads' vertices; the owner re-places or loses it).
   **Deferred: none.**
   **Rules deviations / notes:** Saboteur targets `VP ≥ yours` (official: "equal or
   more"); Deserter's replacement knight arrives inactive (official: same);
   Commercial Harbor lets the victim choose the commodity (official) but the
   resource offered is fixed by the player of the card up front (official: same);
   Wedding's "cards" include commodities; Spy still cannot be played on a full hand;
   a tied barbarian defence still awards nothing (official: progress cards).
   **Bot:** answers every `respondInteraction` (best vertex/edge option, else the
   first option), every forced discard and every follow-up; games remain
   deterministic per seed and finish on every seed tried. It still never plays
   Deserter/Diplomat/Intrigue/Wedding/Saboteur/Commercial Harbor itself (holds
   them), and never displaces a knight on purpose.
   **Client (human-playable):** tap one of your knights → menu with Activate /
   Promote / Move (Move highlights every legal target vertex, including ones
   occupied by a weaker enemy knight — no separate marking yet); "Build knight" button highlights legal vertices;
   responses auto-enter a board mode (vertex or edge targets, Decline where the
   rules allow) or open a mandatory list picker; forced discards reuse the discard
   dialog with the reason in the title; Diplomat picks its road on the board; the
   top strip shows barbarians x/7, the event die, the current player and the knight
   legend; the status line names every waiting state ("Waiting for Grace to answer
   diplomat: re-place your road."). No hover-only controls; one modal at a time.
   **Live drill (room `DRIL` in `.catan-home-data`, gitignored; Ada on `localhost`,
   Grace on `127.0.0.1` — one browser origin holds one seat per room, so a
   multi-tab drill needs two origins):** C&K lobby and setup for 2 humans + 2 bots
   through the UI (second placement is a city, paid), 7-discard modal, robber,
   bank/port trade, Build knight, two barbarian attacks with auto-downgrade,
   Activate/Promote via the tap menu, Improve, Engineer (wall), Merchant (hex pick,
   chip + VP), Crane, a 7-discard with a wall-raised threshold, Deserter as a
   multi-player response (Ada answers on the board, Grace places with Decline
   offered), Saboteur (Ada's forced-discard modal, 7 → 4 cards), Diplomat (edge
   pick, re-place prompt with 4 targets and Decline), a refresh during the Diplomat
   decision and a launcher restart (Ctrl+C) during a robber decision and during the
   Deserter response — every tab recovered its prompt. *Not exercised live* (engine
   tests only): metropolis placement with several eligible cities, knight Move /
   displacement through the UI, Intrigue, Commercial Harbor, Wedding, the
   progress-hand-limit dialog.

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
- Client unit tests cover `deriveServerUrl` and the board-tap → action
  resolver (`tapDispatch.ts`); the rest of the UI is verified manually (see
  the C&K slice-5 live drill for what was actually clicked).
- Next phase: Phase 6 (custom content — house rules, custom event decks,
  61-hex maps) is *not started*; the Wi-Fi smoke test for HOME STABLE
  `v0.6.0-home.1` is still the gate for tagging.
- Colyseus `maxClients` is set above 4 on purpose (per-seat limit is
  enforced in `onJoin`) so a full room stays listed for `joinOrCreate`.

## iPad playtest round 2 — stuck trade + invisible bot turns (2026-09-14)

### 1. The stuck trade — root cause and fix

**Symptom**: a human on the iPad opened a trade and the game "got stuck".

**Root cause** (reproduced in the in-app browser at an iPad-landscape
viewport, 1024×660): the **"Propose a trade" modal did not fit on screen
and could not scroll**. In Cities & Knights the form has 8 give rows + 8
want rows + player chips (+ dev-card rows when that house rule is on): 741 px
tall. `.modal-backdrop` was a fixed, centred, non-scrolling grid, so both the
**Offer** and the **Cancel** button sat below the bottom edge. A complete,
legal selection had no reachable Confirm and no reachable Cancel — exactly
the state the spec forbids. Nothing was wrong server-side: no offer had been
sent, `pendingTrade` was empty, and the room itself was never blocked.
(Portrait iPads fit, which is why it looked intermittent.)

**Fix** (client only):
- `Modal` now has a scrolling body and a **pinned footer** (`.modal-body` /
  `.modal-footer`, `max-height: 100dvh − 24px`). The primary action and
  Cancel are always on screen, at any viewport.
- The footer carries a live **summary of the selection** ("To Bot Ada: give
  2 🌲 for 1 ⛰️", "4 🐑 → 1 ⛰️") or the hint of what is still missing, so a
  touch user can see what will be sent; the primary button is disabled until
  the offer is complete.
- The dialogs' selection → `TradeOffer` mapping moved to a pure module,
  `apps/client/src/components/tradeOffer.ts` (`bankOffer`, `playerOffer`,
  `sideSummary`), unit-tested against the engine
  (`apps/client/test/tradeOffer.test.ts`, 6 tests): every complete selection
  yields an offer the engine accepts; incomplete ones yield none.
- Bank/player trade forms close themselves if it stops being the player's
  main turn (restart, timeout) — no dialog can outlive its legality.
- Same footer treatment for the 7 / forced-discard dialog and the
  incoming-offer Accept/Decline dialog.

**Trade paths audited** (engine → legal actions → client → confirm → refresh):
- Bank 4:1, generic port 3:1, resource port 2:1, Merchant 2:1, commodity
  3:1 / 2:1 with the Trade improvement: one path (`bankOffer` → `proposeTrade`
  without `toPlayerId`), resolved immediately by the engine — nothing
  pending, legal actions refresh on the broadcast. Chips are disabled when
  the ratio can't be paid or the bank is empty; footer says why.
- Player-to-player (incl. commodities in C&K, dev cards under house rule #1):
  `playerOffer` → `proposeTrade` with `toPlayerId` → `pendingTrade`; only the
  counterpart has legal actions (`respondTrade` accept/decline); the proposer
  sees "Waiting for X…", and "Trade with player" is disabled while one is on
  the table. Accept moves cards; decline just clears it. No counter-offers
  (not in the engine; not added).
- Cancel: the dialog is local state; Cancel never sends anything.
- Reconnect/restart mid-trade: the dialog is not persisted (a refresh drops
  the form; nothing was spent). A *pending* offer is persisted with the
  state; on restart the responder's answer is still owed and, for a bot, is
  produced on rejoin (server test).
- Known limitation, unchanged: a human proposer cannot withdraw an offer
  made to a *human* who never answers (no `withdrawTrade` action; the
  responder can decline on return). Not a bot issue.

### 2. Bot turn pacing (presentation only)

Bots **were rolling correctly before** — the persisted games show their
production and `dice` values — but with a single 700 ms pause per action
a two-bot round took ~1.5 s and nobody saw the roll.

Architecture (`apps/server/src/botPacing.ts`, `CatanRoom.scheduleBots`):
- The room still has **one** bot timer. `scheduleBots` now **chooses the
  bot's move first** (pure: seat rng + current state), picks the pause from
  *what* the move is, and applies it after the pause only if the state
  object is still the one it was chosen for (otherwise it re-chooses).
  The seat's rng advances only when the move is actually applied, so
  **timing never touches randomness**; the engine is untouched; nothing
  wall-clock is persisted; a restart simply re-chooses the same
  deterministic move (`lastApplied` is in-memory only).
- Pauses (HOME defaults, `HOME_BOT_PACING`): before roll **800 ms**, dice
  linger after own roll **1100 ms**, between visible actions **650 ms**,
  before end turn **550 ms** (+ the linger if the bot rolled and then ends),
  mandatory answers (discard, trade reply, card response) **650 ms**.
  Env: `BOT_DELAY_MS` keeps its old uniform meaning (tests use 0);
  `BOT_BEFORE_ROLL_MS`, `BOT_AFTER_ROLL_MS`, `BOT_BETWEEN_ACTIONS_MS`,
  `BOT_BEFORE_END_TURN_MS`, `BOT_RESPONSE_MS` override individually.
- New protocol event `EVT.action`: the server broadcasts the applied
  `ActionEnvelope` right before each `game` state. The client's **ticker**
  (bottom of the board) narrates it from that authoritative envelope —
  "Bot Ada rolled 8 (3+5) · ⛵ barbarians", "Bot Ada built a road",
  "Bot Grace declined the trade" — and adds an intent line from state
  ("Bot Ada is rolling…", "… is thinking…", "… is considering the trade…").
  The client invents no actions (`narrate.ts`, pure, unit-tested).
- Tests: `botPacing.test.ts` (4: windows, turn shape, env parsing) and a
  wire-level room test that reboots the server with scaled pacing and
  asserts the gaps between broadcast bot actions.

### 3. Bot trade safety (verified, no change needed)

- Bots only ever *propose* bank trades (the engine lists no player-to-player
  offers in `legalActions`); each resolves at once, so no spam and nothing
  pending on a bot.
- A bot **declines every human offer**, deterministically and independent
  of its rng (`chooseAction` picks `respondTrade accept:false` first).
- `nextActor` names the responder of a pending trade, so the bot timer
  fires for it; on a restart with an offer pending the bot answers once on
  the human's rejoin (server test "trading with bots": decline over the
  wire, restart mid-offer, no duplicate).

### 4. Live drill (in-app browser, 1024×660, 1 human + 2 bots, C&K)

Room created via the UI, setup placed, several full bot rounds observed
through the ticker: "Bot Ada is rolling…" → "Bot Ada rolled 11 (6+5) · ⛵
barbarians" (dice visible) → "Bot Ada moved the robber" → "Bot Ada ended
the turn" → "Bot Grace rolled 9 …". Human 7 → discard dialog (pinned
footer). Bank dialog with nothing affordable: all give chips disabled,
footer hint, **Cancel** returned to the turn with the hand unchanged.
Human→Bot Ada player trade: summary "To Bot Ada: give 2 🌲 for 1 ⛰️",
Offer enabled only when complete, footer on screen at 660 px; bot declined;
End turn available again. Bank 4:1: 5 🐑 → 1 🐑 + 1 ⛰️, ticker "You traded
with the bank". Refresh with a filled-in trade form open: seat reclaimed,
no dialog, nothing spent, turn continues. Room never stuck. **Not
exercised live**: a port trade (no port access in this game), Merchant,
dev-card trades (house rule off in C&K), a real iPad.

## iPad playtest fix — Build Knight tap did not commit (2026-09-13)

**Symptom** (real iPad, C&K): Build Knight → legal white circles appear →
tap a circle → the circle turns solid white ("selected") → nothing else
happens; no `buildKnight` is sent. The desktop/mouse path was fine.

**Root cause**: the client had no "selected vertex" state at all — every
board target is a **one-tap commit** (tap → `sendAction` immediately; there
is no Confirm step, by design). What the tester saw as "selected" was the
`.target-vertex:hover` fill: on iOS the first tap of an element with a
`:hover` rule applies hover, and the click is not reliably delivered. Two
aggravators: the visible disc was ~12 px on a tablet (easy to miss, and a
finger that moves a little becomes a pan, not a click), and the SVG had no
`touch-action`, so a quick second tap was a double-tap zoom.

**Fix** (client only; engine/bot/server untouched):
- `styles.css`: all board `:hover` feedback is now inside
  `@media (hover: hover)` (real pointers only); `.board` gets
  `touch-action: manipulation` and no tap highlight.
- `Board.tsx`: each vertex target is a `<g>` with an invisible 44 px hit
  circle (`.target-hit`, r = 0.42·HEX) around the visible 23 px disc.
- `Game.tsx` + new `components/tapDispatch.ts`: `onVertex`/`onEdge` are
  now a pure resolver `vertexTapAction(mode, legal, v)` /
  `edgeTapAction(mode, legal, e)` that re-checks the tapped target against
  the **current** engine legal-action list on every tap (never the set
  captured when the mode was entered), so a stale target can't submit after
  legal actions change. Mode still resets to idle on every new server state.

**Modes audited** (all share the same one-tap pattern; none had a
"select without commit" path — the bug was the touch layer, not the mode
logic): Build Knight, Move Knight (incl. displacement — the engine lists an
occupied `to`), metropolis placement, city downgrade, wall placement,
progress-card vertex/edge/hex targeting (Bishop-style vertex, Diplomat edge,
hex cards), Merchant (hex), response prompts (vertex/edge), Road Building
(two-tap by design, with "Build just one"), Inventor (two-tap by design).
All vertex/edge modes now go through `tapDispatch.ts` and are covered by
`apps/client/test/tapDispatch.test.ts` (7 tests, one driving the real engine:
tap → `buildKnight` → knight placed, sheep/ore paid, same tap now inert).
Hex modes (robber/knight/Merchant/Inventor/progressHex) still dispatch
inline in `Game.tsx`; they got the same CSS/touch fix but no resolver test.

**Verified**: `pnpm test` 232 green, `pnpm typecheck` clean; live drill in
the in-app browser at tablet size — Build knight → 2 legal targets with
44 px hit areas → tap on the hit ring outside the visible disc → knight on
that vertex, hand 5→3, mode exited, legal actions refreshed. **Not verified
on a real iPad** (no simulator on this machine and the in-app browser's
touch emulation cannot be driven while the pane is hidden) — another iPad
pass is recommended, and should also try Move Knight and a progress-card
board target.

## Gotchas for the next worker

- `lsof -ti :2567 | xargs kill` also matches the *browser's* end of the
  socket — use `lsof -ti :2567 -sTCP:LISTEN` to kill only the server.
- The in-app browser used for verification blocks non-localhost origins;
  LAN checks were done with unit tests + `curl`.
- Vitest for the server runs in `pool: "threads"` (Colyseus + forked
  workers tangle their IPC).
- `pnpm-workspace.yaml` has `allowBuilds` for esbuild (true) and
  msgpackr-extract (false, optional native accelerator).
