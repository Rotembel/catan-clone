# HOME STABLE v0.1 — readiness checklist

The release gate for the tagged home build (`v0.6.0-home.1`). Automated
checks are run by the agent; the Wi-Fi smoke test needs real devices and a
real router, so it is yours. Tag only when every box is ticked.

## Automated (must be green at the candidate commit)

- [ ] `pnpm test` — all packages
- [ ] `pnpm typecheck` — all packages
- [ ] mapgen determinism (`packages/rulesets/test/mapgen.test.ts`)
- [ ] 5-seat full bot games on `home-large-5`, four seeds (`apps/cli/test/fullGame.test.ts`)
- [ ] persistence/restart with a generated board and bot seats (`apps/server/test/CatanRoom.test.ts`)
- [ ] reconnect without duplicate seats; superseded connection closed (same file)

## Real Wi-Fi smoke test

Host machine = the laptop that runs the game. Everyone else = phones,
tablets, other laptops on the **same Wi-Fi**.

1. Host joins the Wi-Fi. Turn off any VPN.
2. In the repo: `pnpm install` (first time only), then **`pnpm run home`**.
   - It prints the version + commit, the saves directory, and a box with
     `http://192.168.x.x:5173`. If it says a port is in use, follow the message.
3. On **two other physical devices**, open the printed `http://…:5173` URL.
   - If a phone can't load it: check the host firewall allows Node on ports
     5173 and 2567, and that the router isn't isolating clients ("AP isolation").
4. Host: enter a name → **Create a room**. Read the 4-letter code aloud.
5. The two devices: name → code → **Join**.
6. Host: **Add bot** twice → 3 humans + 2 bots. Pick **Home Large — 5 Seats**.
   The diagnostics line at the bottom shows `v0.6.0-home.1 · <commit> · home-lan · mapgen-v1`.
7. **Start game**. Complete the **three** placement rounds (bots place on their own,
   with a short pause each).
8. Play **at least five full rounds** (every seat rolls at least once, bots included).
   Do at least one bank trade and one player trade.
9. **Refresh** one human's browser → it comes back in the same seat with the same board.
10. **Turn Wi-Fi off and on** on one phone (10–20 s) → "reconnecting…" then back, same seat.
11. **Restart the server**: Ctrl+C in the `pnpm run home` terminal, run `pnpm run home` again.
    All devices reconnect on their own; the board, hands and turn are exactly as before;
    the bots resume when it is their turn (they wait until a human is connected).
12. Confirm: no seat is duplicated, no bot moves twice for one roll, the map did not change.
13. Play to a winner if there is time; the scoreboard shows.

Record the result in `HANDOFF.md` (date, devices used, commit, anything odd).
If all of it held, the commit can be tagged `v0.6.0-home.1`.

## Known limits of this build (accepted for v0.1)

- Base-game rules only (Home Large); Cities & Knights is not part of the home build.
- Bots are simple (no trading with humans, decline offers) but always legal.
- Everyone must be on the same Wi-Fi; no internet play (that is the separate deploy track).
- One host laptop; if it sleeps, the game pauses until it wakes (saves are on disk).
