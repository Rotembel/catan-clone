// Server entry point: one Colyseus server, one room type, one store.
//
//   pnpm --filter @catan/server dev
//
// Games are persisted to CATAN_DATA_DIR (default ./data) after every
// action, so restarting this process does not lose a game in progress.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@catan/shared";
import { CatanRoom } from "./CatanRoom.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT ?? 2567);
const dataDir = resolve(process.env.CATAN_DATA_DIR ?? "data");
const store = new FileStore(dataDir);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

// Rooms are matched on their code, so `joinOrCreate("catan", { code })`
// lands in the live room for that code — or creates one, which then
// rehydrates from the store if the code is known.
gameServer.define(ROOM_NAME, CatanRoom, { store }).filterBy(["code"]);

gameServer.listen(port).then(async () => {
  const known = await store.list();
  console.log(`catan server listening on ws://localhost:${port}`);
  console.log(`persisting to ${dataDir} (${known.length} saved game${known.length === 1 ? "" : "s"})`);
});
