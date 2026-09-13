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
| 5 Cities & Knights | **slices 1–2 of 5 done** (1: commodities + city improvements; 2: event die, barbarians, knights) — paused after slice 2 by owner decision | `d8ec23a`, slice-2 commit | 34 engine tests for the expansion + 4 seeded bot games at 13 VP with card conservation, a barbarian attack, and knights built |
| 6 Custom content | not started | — | |

Also done outside the phase list: client server-URL derives from the
page's hostname (LAN play), `.env.example`, `HANDOFF.md`.

**142 tests** across the workspace (engine 98, rulesets 14, client 3,
cli 12, server 15). `pnpm typecheck` clean in all 6 packages.

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
3. progress cards (three decks, drawn by event die vs. improvement level; aqueduct at
   science 3)
4. metropolises (level 4/5), city walls, merchant
5. client UI for all of the above (slice 1's UI is already in)

## Next track (owner decision after slice 2): HOME STABLE v0.1

Cities & Knights is **paused after slice 2**. Before slice 3, build the playable
home release described in `docs/planning/`: 5 seats, 3 humans + 2 server-controlled
bots, large map preset (37 hexes, 3 opening placements each), LAN launcher,
version surface, tagged known-good build, real Wi-Fi smoke test. Base-game rules
(plus stable house rules) for that release — not C&K.

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
