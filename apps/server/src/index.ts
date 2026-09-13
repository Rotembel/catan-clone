// Server entry point: one Colyseus server, one room type, one store.
//
//   pnpm --filter @catan/server dev          (dev, ./data)
//   pnpm run home                            (home-lan profile, see scripts/home.mjs)
//
// Games are persisted to CATAN_DATA_DIR (default ./data) after every
// action, so restarting this process does not lose a game in progress.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@catan/shared";
import { describeBuild, readBuildInfo } from "./build.js";
import { CatanRoom } from "./CatanRoom.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT ?? 2567);
const dataDir = resolve(process.env.CATAN_DATA_DIR ?? "data");
const store = new FileStore(dataDir);
const build = readBuildInfo();
const botDelayMs = Number(process.env.BOT_DELAY_MS ?? 700);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

// Rooms are matched on their code, so `joinOrCreate("catan", { code })`
// lands in the live room for that code — or creates one, which then
// rehydrates from the store if the code is known.
gameServer
  .define(ROOM_NAME, CatanRoom, { store, build, persistence: dataDir, botDelayMs })
  .filterBy(["code"]);

gameServer.listen(port).then(async () => {
  const known = await store.list();
  console.log(`catan server ${describeBuild(build)}`);
  console.log(`listening on ws://0.0.0.0:${port} (all interfaces)`);
  console.log(`persisting to ${dataDir} (${known.length} saved game${known.length === 1 ? "" : "s"})`);
});
