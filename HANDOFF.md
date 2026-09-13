# Handoff — where the Catan clone stands

Worker note for whoever picks this up next (human or agent). Read `SPEC.md`
for the plan and `CLAUDE.md` for conventions; this file is *status*: what
exists, how it's verified, what's decided, what's next.

Repo: https://github.com/Rotembel/catan-clone (private) · local:
`~/Desktop/catan-starter-docs` · `main` is green and pushed as of commit
`9bd4bad`.

## Phases

| Phase | Status | Commit | Proof |
|---|---|---|---|
| 0 Foundation | done | `006a6c9` | geometry tests, incl. pixel cross-check on the 19-hex board |
| 1 Full base game, local | done | `df784bd` | 77 tests; bot games finish on every seed with invariants checked |
| 2 Real-time multiplayer | done | `4360969` | 8 socket tests; played live in two browser tabs |
| 3 Stability | done | `598acf4` | server killed & restarted mid-game twice; both tabs resumed and play continued |
| 4 House rule #1 (trade dev cards) | done | `9bd4bad` | flag-on/off tests at ruleset, engine, server; live offer of a card |
| 5 Cities & Knights | not started | — | |
| 6 Custom content | not started | — | |

Also done outside the phase list: client server-URL derives from the
page's hostname (LAN play), `.env.example`, `HANDOFF.md`.

**101 tests** across the workspace (engine 64, rulesets 11, client 3,
cli 8, server 15). `pnpm typecheck` clean in all 6 packages.

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
