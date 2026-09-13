# Planning Handoff — Map Generator + Home LAN Stable Build

These files were prepared outside the repository so Claude can integrate them in later phases without interrupting the current Cities & Knights work. They now live in `docs/planning/` and are **design / future-phase documents**, not instructions to implement immediately. Each carries a "status on integration" note listing what the repo already does.

## Files

- `MAP_GENERATOR_DESIGN.md`
  - deterministic procedural large maps;
  - balance scoring;
  - 37/61-hex scale;
  - variable setup rounds;
  - first target: 5 seats, 3 humans + 2 bots.

- `HOME_LAN_VERSION_WRAP.md`
  - stable tagged home build;
  - one-command LAN launcher;
  - dedicated persistence;
  - live bot seats;
  - recovery/reconnect drills;
  - home release gate.

## Integration guidance

Do not fold these into the current Phase 5 slice unless needed.

Recommended order after the current expansion checkpoint:

1. land the planning docs only;
2. finish/green the active Phase 5 slice;
3. implement mapgen as its own feature phase;
4. implement home-LAN wrapper and live bot seats;
5. combine them in `Home Large — 5 Seats`;
6. run real Wi-Fi smoke test;
7. tag known-good home release.

Current repo status reported by Claude when these docs were prepared:
- `main` advanced to `d8ec23a`;
- Phase 5 slice 1 (commodities + city improvements) green;
- 120 tests and typecheck clean;
- next planned expansion slice: event die, barbarians, knights.

The home release should remain independently shippable from later C&K slices.

## Reusable card-effect pattern (from C&K slice 3, for future custom/event decks)

`packages/engine/src/progress/types.ts` — a card is a small pure module:
`{ id, options(state, ruleSet, playerId) → payload[], apply(state, ruleSet, playerId, payload) → state }`.
`options` is the bounded legal-payload enumeration that `legalActions` lists (so bots and
the UI need no card-specific knowledge); `apply` validates and returns the new state.
Definitions (id, category, count, timing) are rule-set data; decks are
`{ draw, discard }` piles in `GameState` with seeded shuffles. A Phase 6 custom deck is
the same shape with its own registry and definitions — not a scripting engine.
