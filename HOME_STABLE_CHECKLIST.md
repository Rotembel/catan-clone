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

0. Before leaving home: `pnpm install`, `pnpm test`, and clear old drill rooms from
   `.catan-home-data/` (or move the folder aside) so the night starts clean.
1. Host joins the Wi-Fi. Turn off any VPN.
2. In the repo: **`pnpm run home`**.
   - It prints the version + commit, the saves directory, and a box with two
     addresses: `http://<laptop-name>.local:5173` (preferred) and
     `http://192.168.x.x:5173` (fallback). If it says a port is in use, follow the message.
   - macOS may ask whether to allow incoming connections for `node` — click **Allow**.
3. On **two other physical devices**, open the **`.local`** address; if a device can't
   resolve it (some Android phones), use the IP address instead. (Either works now; the
   `.local` 403 seen on the first night was Vite's host guard and is fixed.)
   - Why it matters: each phone keeps its seat token *per address*. If the laptop's IP
     changes mid-evening, phones that used the IP lose their seat; phones on the
     `.local` name don't.
   - If a phone can't load either: check the host firewall allows Node on ports
     5173 and 2567, and that the router isn't isolating clients ("AP isolation").
4. Host: enter a name → **Create a room**. Read the 4-letter code aloud.
5. The two devices: name → code → **Join**.
6. Host: **Add bot** twice → 3 humans + 2 bots. Pick **Home Large — 5 Seats**.
   The diagnostics line at the bottom shows `v0.6.0-home.1 · <commit> · home-lan · mapgen-v1`.
7. **Start game**. Complete the **three** placement rounds (bots place on their own,
   with a short pause each). After each player's **second** settlement they receive one
   card per adjacent producing hex; the first and third pay nothing.
8. Play **at least five full rounds** (every seat rolls at least once, bots included).
   Do at least one bank trade and one player trade.
9. **Refresh** one human's browser → it comes back in the same seat with the same board.
   - If a phone lost the page entirely (app killed, fresh tab): open the same address →
     the home screen shows **Resume room CODE as Name** — tap it. Typing the code into
     Join also rejoins the same seat; the name typed there is display only.
10. **Turn Wi-Fi off and on** on one phone (10–20 s) → "reconnecting…" then back, same seat.
    - While it says "Can't reach the server — retrying…", **do not tap "Give up and start
      over"**: that button deletes the phone's seat token and the seat can't be reclaimed.
11. **Restart the server**: Ctrl+C in the `pnpm run home` terminal, run `pnpm run home` again.
    All devices reconnect on their own; the board, hands and turn are exactly as before;
    the bots resume when it is their turn (they wait until a human is connected).
    - Keep the same room: the saves live in `.catan-home-data/<CODE>.json` (with a
      `.bak`); as long as that folder is untouched, the same code resumes the same game.
12. Confirm: no seat is duplicated, no bot moves twice for one roll, the map did not change.
13. Play to a winner if there is time; the scoreboard shows.

Record the result in `HANDOFF.md` (date, devices used, commit, anything odd).
Afterwards copy `.catan-home-data/` somewhere safe if you want to keep the game.
If all of it held, the commit can be tagged `v0.6.0-home.1`.

## Known limits of this build (accepted for v0.1)

- Base-game rules only (Home Large); Cities & Knights is not part of the home build.
- Bots are simple (no trading with humans, decline offers) but always legal.
- Everyone must be on the same Wi-Fi; no internet play (that is the separate deploy track).
- One host laptop; if it sleeps, the game pauses until it wakes (saves are on disk).
