# Home LAN Version Wrap — Stable Playable Build

Status: release/workflow proposal (DESIGN / FUTURE-PHASE document — not an instruction to implement now).  
Primary scenario: play at a friend's house over their Wi-Fi with **3 humans + 2 bots** on a **large generated map**.

> **Status on integration (added when this doc was committed, at `d8ec23a` + docs):**
> already true in the repo, so these items are *keep* rather than *build*:
> - §3 LAN binding: Vite runs with `host: true` and the Colyseus server listens on all
>   interfaces (`*.2567`); the client derives `ws://<page hostname>:<port>` with
>   `VITE_SERVER_PORT` / `VITE_SERVER_URL` overrides (`apps/client/.env.example`).
> - §5 persistence: `CATAN_DATA_DIR` exists; the room record (seats + tokens, ruleset
>   incl. board, game) is written after every authoritative action, durable-then-broadcast;
>   a restarted server rehydrates the room on the next join. A dedicated *home* data dir
>   is just a different `CATAN_DATA_DIR`.
> - §11 recovery: server restart and client refresh are already safe for human seats
>   (Phase 3, tested); reconnect is automatic via the seat token in `sessionStorage`, so
>   "Resume game" is implicit today. Bot seats are not persisted yet (none exist).
> - §6 bots: the CLI bot is already a pure `chooseAction(state, ruleSet, playerId, rng)`
>   over the engine's `legalActions` (`apps/cli/src/bot.ts`), so a server-owned
>   `BotController` can wrap it directly — no browser client needed. It should move out
>   of `apps/cli` into a package both the CLI and server import.
> - Not yet: `BuildInfo`/version surface, launcher, LAN-IP printout, bot lobby seats,
>   presets, release tag.

## 1. Goal

Create a boring, reliable, versioned home-game build that can be carried to another house, started with minimal setup, and recovered if a browser or server restarts.

This is not a public production deployment. It is a **LAN release profile**.

Success means:

1. one host laptop starts the game server and client;
2. phones/tablets/laptops on the same Wi-Fi can open one URL;
3. 3 human players occupy seats and 2 bots occupy seats;
4. the lobby launches a large generated 5-seat map;
5. reconnects and server restarts preserve the game;
6. the exact build can be identified and reproduced later.

## 2. Release identity

Add a single version surface visible in:

- server startup log;
- client footer or lobby diagnostics;
- persisted match metadata.

Suggested metadata:

```ts
export interface BuildInfo {
  appVersion: string;      // e.g. 0.6.0-home.1
  gitCommit: string;       // short SHA
  buildProfile: "dev" | "home-lan" | "production";
  mapGenerationVersion?: string;
}
```

Suggested first tag:

```text
v0.6.0-home.1
```

Do not call a build “home stable” unless all release gates below pass.

## 3. LAN networking

The client already derives the server URL from the page hostname. Keep that behavior.

Home profile should bind services to LAN interfaces:

```text
client: 0.0.0.0:<client-port>
server: 0.0.0.0:<server-port>
```

Expected flow:

1. host joins friend's Wi-Fi;
2. start one home launcher;
3. launcher prints the host LAN IP and player URL;
4. other devices visit something like `http://192.168.x.x:5173`;
5. WebSocket connection uses the same host automatically.

No player should need to edit an IP or environment variable manually.

## 4. One-command launcher

Create a root-level launcher for the home profile.

Desired UX on the host:

```text
pnpm home
```

or a platform helper such as:

```text
start-home-game.ps1
```

It should:

- validate dependencies/config;
- start server;
- start client;
- use a dedicated persistent data directory;
- print LAN URLs;
- print build/version info;
- fail clearly if ports are occupied;
- avoid killing unrelated processes automatically.

A later convenience wrapper can open the host browser automatically.

## 5. Dedicated persistence

Home games must not share disposable dev storage.

Suggested path:

```text
apps/server/data/home/
```

or environment-driven:

```text
CATAN_DATA_DIR=.catan-home-data
```

Requirements:

- persist after every authoritative action;
- restart server and rehydrate exact match state;
- preserve generated `BoardLayout`, map seed, generation version, seats, bots, ruleset, and tokens;
- never silently replace an existing room with a new game.

## 6. Bot seats

Add explicit lobby support for bot seats.

Suggested lobby model:

```ts
type SeatKind = "human" | "bot";
```

Host controls:

- add bot;
- remove bot;
- bot difficulty/profile later;
- launch only when all intended seats are filled.

First target:

```text
Seat 1: Human
Seat 2: Human
Seat 3: Human
Seat 4: Bot
Seat 5: Bot
```

Bots must run server-side or in a server-owned worker/runtime, not as a browser tab that must stay open.

The current CLI bot *can* be embedded (it is a pure function over `legalActions`; see the status note); create a thin `BotController` around it rather than duplicating AI rules.

## 7. Bot turn behavior

For v1 home mode:

- bot acts only when it is its turn or when it has a required interrupt action;
- bot waits a short configurable human-visible delay before actions;
- bot uses only legal engine actions;
- no wall-clock value may affect authoritative randomness;
- bot choice can be deterministic from state + bot seed.

Important C&K follow-up: bots must eventually handle discard, robber, knights, event-die consequences, commodities, improvements, and barbarian flow before a C&K home build is marked stable.

## 8. Large-map home preset

Add a named preset, not a collection of unrelated lobby switches.

Suggested:

```text
Home Large — 5 Seats
```

Initial contents:

```ts
{
  seats: 5,
  humansRecommended: 3,
  botsRecommended: 2,
  boardPreset: "large",
  mapSeed: "random-at-room-create",
  setupPreset: "three-settlements",
  victoryPoints: 13, // provisional
}
```

Later:

```text
Home Large C&K — 5 Seats
```

can use:

```text
2 settlements + 1 city
```

after the expansion and bots support it fully.

## 9. Lobby diagnostics

Before starting, show:

- app version;
- room code;
- ruleset;
- map preset;
- map seed;
- human/bot seat count;
- persistence status;
- server connection status.

Optional host-only button:

```text
Copy diagnostics
```

which returns a small text block useful for debugging.

## 10. Release gate

A version may receive a `home` tag only if all of these pass.

### Automated

- `pnpm test`
- `pnpm typecheck`
- generated-map deterministic tests
- 5-seat full bot simulation on the home preset for multiple seeds
- persistence/reload test with generated map
- reconnect tests
- bot seat ownership / action authorization tests

### Manual LAN smoke test

On a real Wi-Fi network:

1. start home profile on host;
2. connect at least two other physical devices;
3. create 5-seat room;
4. configure 3 humans + 2 bots;
5. generate large map;
6. finish setup;
7. play several rounds;
8. refresh one human browser;
9. disconnect/reconnect Wi-Fi on one device;
10. restart server once;
11. verify all clients resume the same game;
12. verify bots continue correctly;
13. verify no duplicate seat or bot actions.

### Release artifact

Record:

```text
tag
commit SHA
test count
ruleset
mapgen version
known issues
```

## 11. Recovery behavior

If something fails during game night:

- server restart should be safe;
- client refresh should be safe;
- host should be able to reopen the same room;
- bot seats should be reconstructed from persisted seat metadata;
- generated map must never regenerate with a different candidate after reload.

Add a visible “Resume game” path for persisted rooms if not already obvious in the UI.

## 12. Version freeze discipline

Once a build passes the home release gate:

- tag it;
- do not use `main` directly for game night if newer work is in progress;
- keep the known-good tag available;
- new features land on `main`, but home night launches from the known-good tag/build until another home release passes.

This creates a stable playable checkpoint even while Cities & Knights and house-rule work continue.

## 13. Suggested phases

### Home Wrap A — version surface

- `BuildInfo`
- startup/lobby version display
- tag convention
- diagnostics

### Home Wrap B — launcher + LAN validation

- one-command launcher
- LAN URL discovery
- dedicated persistence directory
- port checks

### Home Wrap C — live bot seats

- bot lobby seats
- server-owned bot controller
- reconnect/restart persistence
- 3-human + 2-bot integration test

### Home Wrap D — large generated map

Depends on mapgen-v1.

- `Home Large — 5 Seats`
- 37-hex generated board
- 3 opening placements
- bot setup upgrade
- full seeded game tests

### Home Wrap E — release candidate

- real Wi-Fi smoke test
- restart/reconnect drill
- tag `v0.6.0-home.1`
- freeze known-good build

## 14. Important separation from Phase 5

Do not block the home wrap on every Cities & Knights feature unless the chosen home ruleset requires them.

Two valid tracks can coexist:

1. **Home Stable Base/House Rules** — large map + bots + LAN;
2. **Cities & Knights development** — expansion slices continue separately.

Once C&K and bots are both mature, create a later `home-large-cnk` preset.

## 15. Immediate decision recommendation

For the first playable home release, use:

- 5 seats;
- 3 humans;
- 2 bots;
- base-game mechanics plus already-stable house rules only;
- 37-hex generated board;
- 3 starting settlements per player;
- deterministic seed;
- 13 VP provisional target;
- dedicated LAN persistence;
- tagged known-good build.

This minimizes the number of moving pieces while still testing the exact experience we care about.
