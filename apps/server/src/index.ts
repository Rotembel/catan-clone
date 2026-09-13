// Server entry point: one Colyseus server, one room type.
//
//   pnpm --filter @catan/server dev

import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@catan/shared";
import { CatanRoom } from "./CatanRoom.js";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

// Rooms are matched on their code, so `join("catan", { code })` lands in
// the room the host created with that code.
gameServer.define(ROOM_NAME, CatanRoom).filterBy(["code"]);

gameServer.listen(port).then(() => {
  console.log(`catan server listening on ws://localhost:${port}`);
});
