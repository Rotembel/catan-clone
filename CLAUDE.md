# CLAUDE.md — Catan Clone

Project conventions for Claude Code. Read `SPEC.md` for the full architecture and phased plan;
this file is the short "how we work here" reference.

## What this project is
A stable, real-time online Catan replacement, architected so "house rules" are configuration,
not code rewrites. Stability and correctness come before any new feature. Full details in `SPEC.md`.

## Golden rules (do not violate without flagging)
- **Server-authoritative.** The server is the single source of truth. Clients send intents; the server validates, applies, persists, broadcasts.
- **Pure, deterministic engine.** The core reducer `apply(state, action, ruleSet)` has no `Date.now()`, no `Math.random()`. Inject a seeded RNG. Same inputs → same output.
- **Rules are data.** Costs, counts, VP target, board layout, and card definitions come from the `RuleSet`, never hardcoded in engine logic.
- **One type source.** `GameState`, `Action`, `RuleSet` live in `packages/shared` and are imported everywhere. No duplicate definitions.
- **Client renders, never decides.** It may run the engine for optimistic UI, but the server has the final word.

## Workflow
- Work **one phase at a time** (see `SPEC.md` §7). Do not jump ahead.
- End every phase **green**: `pnpm test` passes, then **commit and push** before starting the next phase.
- Use git as the safety net (see `SPEC.md` §8): `main` stays working; risky or long changes — each house rule — get a feature branch merged only when tests pass. Commit messages are imperative and scoped (`engine: add longest-road computation`).
- Write tests for engine logic **before or alongside** the logic — especially board geometry and the tricky rules (distance rule, longest road, largest army, robber, port ratios, victory).
- Prefer **editing files in place** over regenerating whole files.
- Ask before adding a runtime dependency not listed in `SPEC.md` §2.

## Commands
```bash
pnpm install        # from repo root
pnpm test           # Vitest — must be green before any commit
pnpm --filter engine test
pnpm --filter client dev
pnpm --filter server dev
```
(Wire these up in Phase 0 if they don't exist yet.)

Git, from Phase 0:
```bash
git init && git add . && git commit -m "chore: scaffold project"
# create a PRIVATE repo, then:
git remote add origin <url> && git push -u origin main
```

## Code style
- TypeScript strict mode everywhere. No `any` without a written reason.
- Engine code is **pure functions only** — no I/O, no globals, no side effects.
- Names: types `PascalCase`, values `camelCase`, action `type` strings `camelCase` (`"buildRoad"`).
- Keep reducers small: one file per action family under `packages/engine/src/reducers/`.
- Commit messages: imperative, scoped, e.g. `engine: add longest-road computation`.

## Board geometry reminder
Hexes use axial coords `(q, r)`. Vertices and edges are **derived** with one canonical addressing
scheme so a shared corner has exactly one id. Get this right in Phase 0 and test it — most
Catan-clone bugs come from inconsistent vertex/edge identity.

## When unsure
Re-read the relevant `SPEC.md` section. If a decision isn't covered there (art, auth vs room-code,
mobile scope — see `SPEC.md` §8), ask rather than guessing.
