# Procedural Map Generator — Design Spec

Status: proposal for a future implementation phase (DESIGN / FUTURE-PHASE document — not an instruction to implement now).  
Target repo: `Rotembel/catan-clone`  
Current integration note: Phase 5 / Cities & Knights is in progress; this document is intentionally implementation-neutral so it can land after the expansion slices.

> **Status on integration (added when this doc was committed, at `d8ec23a` + docs):**
> what already exists in the repo that this design builds on — see `HANDOFF.md` for the
> full picture.
> - The current board path is already a *seeded generator*, not a static layout:
>   `packages/rulesets/src/board.ts` → `generateBaseBoardLayout(rngState, radius)`
>   shuffles resources/tokens and places ports on detected coastal edges, and
>   `createBaseRuleSet({ seed, radius })` already produces 37 hexes at `radius: 3`
>   (tested in `packages/rulesets/test/base.test.ts`). Mapgen-v1 generalises this;
>   it does not need to "preserve a static path".
> - Canonical geometry is `packages/engine/src/board/*`; `hexagonAxials(radius)` is
>   the existing `hexRadius` shape source.
> - Persistence already stores the whole `RuleSet` (including `board`) in the room
>   record after every action, so a generated layout is already persisted rather than
>   regenerated on reconnect/restart. `generationVersion`/`seed` metadata is new.
> - Setup rules: implemented in HOME STABLE v0.1 as `RuleSet.setup: SetupRules`
>   with `rounds` and **`startingResourcesRound`** (1-based; exactly one round pays,
>   not "from this round onward" as §6's `grantStartingResourcesFromRound` suggests —
>   the owner chose "second settlement pays" for the 3-round preset after the first
>   real game).

## 1. Goal

Add a deterministic procedural board generator capable of producing large, replayable, reasonably balanced maps for 3–8 players while preserving the existing `BoardLayout` contract (today produced by the seeded `generateBaseBoardLayout`; see the status note above).

The first practical target is a **large 5-seat game** for **3 humans + 2 bots** on a home LAN.

The generator must preserve the project’s existing architectural rules:

- server-authoritative game state;
- pure deterministic engine;
- seeded randomness only;
- rules/configuration are data;
- canonical vertex/edge identity remains derived from board geometry;
- the client renders a generated `BoardLayout`; it never decides authoritative board content.

## 2. Architecture

Split generation into three components.

### 2.1 `BoardShapeGenerator`

Decides which axial hex coordinates exist.

```ts
export interface BoardShapeConfig {
  shape: "hexRadius" | "trimmedHex" | "islands" | "customMask";
  radius?: number;
  targetHexCount?: number;
  customMask?: Array<{ q: number; r: number }>;
}
```

Output:

```ts
export interface GeneratedBoardShape {
  hexes: Array<{ q: number; r: number }>;
}
```

No resources, numbers, ports, or robber placement are decided here.

### 2.2 `BoardContentGenerator`

Assigns terrain, number tokens, ports, deserts/barren tiles, and robber start position to an existing shape.

```ts
export interface BoardContentConfig {
  resourceWeights: Partial<Record<Resource, number>>;
  desertCount: number;
  portPolicy: {
    generic: number;
    specific: Partial<Record<Resource, number>>;
  };
  constraints: {
    separateHighProbabilityNumbers: boolean;
    maxSameResourceCluster: number;
    avoidMatchingPortNearResourceCluster: boolean;
  };
}
```

The result should be a normal `BoardLayout` so the rest of the engine does not care whether the board was static or generated.

### 2.3 `BoardBalanceEvaluator`

Pure scoring function. It evaluates candidate layouts and never mutates state.

```ts
export interface BoardBalanceScore {
  total: number;
  productionSpread: number;
  resourceDiversity: number;
  startSpotFairness: number;
  highNumberSeparation: number;
  portFairness: number;
  penalties: string[];
}
```

Recommended v1 flow:

1. Generate shape.
2. Generate 250 deterministic content candidates from the supplied seed.
3. Score each candidate.
4. Return the highest-scoring candidate.
5. Persist both the resulting layout and generator metadata.

Later presets may raise candidate count to 500–2000.

## 3. Determinism and persistence

```ts
generateBoard(config, seed) -> {
  layout,
  score,
  seed,
  generationVersion
}
```

Requirements:

- same config + seed + generationVersion => identical board;
- no `Math.random`;
- no timestamp-dependent generation;
- persist the generated `BoardLayout`, not only the seed;
- also persist `generationVersion` so historical games stay stable after the algorithm evolves.

Suggested initial version:

```ts
generationVersion: "mapgen-v1"
```

## 4. Map size presets

Do not hardcode player count to one board size.

| Preset | Approx. land hexes | Intended seats | Suggested opening |
|---|---:|---:|---|
| `classic` | 19 | 3–4 | 2 settlements |
| `expanded` | ~30–37 | 4–6 | 2–3 placements |
| `large` | 37 | 5–6 | 3 placements |
| `mega` | 50–61 | 6–8 | 3 placements |
| `custom` | configurable | configurable | ruleset-defined |

A complete axial hex radius gives:

- radius 2 → 19 hexes
- radius 3 → 37 hexes
- radius 4 → 61 hexes

A `trimmedHex` preset can remove coast tiles while retaining connectivity to produce less symmetric boards.

## 5. Balance model

The goal is not perfect equality. It is to reject obviously broken maps.

Use standard 2d6 production weights:

```text
2  -> 1
3  -> 2
4  -> 3
5  -> 4
6  -> 5
8  -> 5
9  -> 4
10 -> 3
11 -> 2
12 -> 1
```

`7` never receives a production token.

### 5.1 Vertex score

For every legal settlement vertex:

```text
vertexProduction =
  sum(adjacentHex.pipWeight)
```

Also calculate production by resource.

### 5.2 Start-spot fairness

For a target seat count and opening-placement count:

- find strong legal starting vertices while respecting the distance rule;
- estimate how many independent viable openings exist;
- penalize boards where the strongest few vertices dominate the rest;
- penalize regions where good openings require the same scarce resource;
- evaluate spatial spread so all seats have meaningful expansion room.

For 5 seats with 3 opening placements each, the board needs enough viable territory for **15 initial structures**, not merely 10.

### 5.3 High-number separation

Penalize:

- adjacent 6/8 tiles;
- dense clusters of 5/6/8/9;
- one geographic zone containing too much of the board’s expected production.

### 5.4 Resource diversity

Penalize:

- large same-resource clusters;
- regions with strong pips but only one or two resources;
- severe scarcity of one resource without a deliberate preset rule.

### 5.5 Ports

Ports should be generated after coastline detection.

Evaluate:

- even coastal distribution;
- reasonable distance between ports;
- no extreme concentration near one strong opening zone;
- specific 2:1 ports should not trivially combine with a huge adjacent cluster of that same resource.

## 6. Variable setup rules

Opening structure count should become ruleset data.

Suggested shape:

```ts
export interface SetupRules {
  sequence: "snake";
  rounds: SetupRound[];
  grantStartingResourcesFromRound?: number;
}

export interface SetupRound {
  piece: "settlement" | "city";
  road: boolean;
}
```

Examples:

Classic:

```ts
setup: {
  sequence: "snake",
  rounds: [
    { piece: "settlement", road: true },
    { piece: "settlement", road: true }
  ],
  grantStartingResourcesFromRound: 2
}
```

Large 5-player preset:

```ts
setup: {
  sequence: "snake",
  rounds: [
    { piece: "settlement", road: true },
    { piece: "settlement", road: true },
    { piece: "settlement", road: true }
  ],
  grantStartingResourcesFromRound: 3
}
```

Alternative 5-player C&K-style preset:

```ts
setup: {
  sequence: "snake",
  rounds: [
    { piece: "settlement", road: true },
    { piece: "city", road: true },
    { piece: "settlement", road: true }
  ],
  grantStartingResourcesFromRound: 3
}
```

The engine should not assume the second placement is always the only resource-granting placement.

*(Current code, for reference: `placeSetupSettlement` in
`packages/engine/src/reducers/setup.ts` grants resources only on `setupSettlement2`, and
the C&K flag `setupSecondPlacementIsCity` turns that placement into a city. `SetupRules`
replaces both special cases with data.)*

## 7. Recommended first presets

### `home-large-5`

Target use case: 3 humans + 2 bots.

- seats: 5
- map: 37 land hexes
- opening: 3 structures per player
- recommended first version: 3 settlements
- optional C&K variant: 2 settlements + 1 city
- higher VP target than classic; suggested configurable range: 13–15
- bot-compatible and deterministic

### `mega-6`

- seats: 6
- map: 50–61 land hexes
- 3 opening placements each
- larger port count
- victory target: ruleset configurable

## 8. Bot compatibility

Bots must consume the same public game state and legal-action surface as humans.

The map generator should expose no private advantage.

Bot setup logic must be upgraded from “choose one good vertex” to a multi-placement evaluation that considers:

- expected production;
- resource diversity;
- future road expansion;
- port access;
- overlap with the bot’s earlier placements;
- opponent denial only as a secondary factor.

For deterministic test runs, bot choices should be deterministic under the game seed.

## 9. Testing requirements

Add tests for:

- identical seed produces identical map;
- different seeds produce valid maps;
- no duplicate axial coordinates;
- board remains connected for connected presets;
- no 6/8 adjacency when the preset forbids it;
- correct resource/token totals;
- valid coastline ports;
- enough legal starting locations for intended setup count;
- generated board works with existing canonical vertex/edge geometry;
- full seeded bot games finish on generated boards;
- generated maps survive persistence/reload exactly.

## 10. Suggested implementation order

1. Extract `BoardLayout` validation (the existing generator has none beyond its tests).
2. Add `BoardShapeGenerator`.
3. Add deterministic content shuffling.
4. Add constraint validation.
5. Add `BoardBalanceEvaluator`.
6. Add preset registry.
7. Add variable setup rules.
8. Update bots for 3-placement opening.
9. Add lobby preset selector and optional seed field.
10. Run multi-seed full-game regression tests.

## 11. Open design decisions

Do not decide these implicitly during implementation:

- exact 5-player resource distribution for 37 hexes;
- 3 settlements vs 2 settlements + 1 city as the default large-map opening;
- starting resource grants when there are 3 setup rounds;
- default VP target for `home-large-5`;
- whether large maps use one robber or multiple blockers;
- whether water gaps/islands belong in mapgen-v1 or later.
