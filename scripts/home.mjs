#!/usr/bin/env node
// `pnpm run home` — the one-command LAN launcher (docs/planning/HOME_LAN_VERSION_WRAP.md §3-4).
//
// Starts the authoritative server and the client on all interfaces with a
// dedicated persistence directory, prints the URL friends type into their
// phones, and prints the build identity. Fails clearly if a port is taken.
// Only ever stops the two processes it started.

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPort = Number(process.env.PORT ?? 2567);
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);
const dataDir = resolve(root, process.env.CATAN_DATA_DIR ?? ".catan-home-data");

function version() {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version ?? "0.0.0";
}
function gitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}
function portFree(port) {
  return new Promise((done) => {
    const probe = net.createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "0.0.0.0");
  });
}

const commit = gitCommit();
console.log(`\nCatan — HOME profile  v${version()} (${commit})`);
console.log(`saves: ${dataDir}${existsSync(dataDir) ? "" : " (will be created)"}\n`);

for (const [label, port] of [["server", serverPort], ["client", clientPort]]) {
  if (!(await portFree(port))) {
    console.error(`Port ${port} (${label}) is already in use. Stop whatever is using it, or set ${label === "server" ? "PORT" : "CLIENT_PORT"} to another port, then run pnpm run home again.`);
    process.exit(1);
  }
}

if (!existsSync(resolve(root, "node_modules"))) {
  console.error("Dependencies are not installed. Run: pnpm install");
  process.exit(1);
}

const env = {
  ...process.env,
  CATAN_DATA_DIR: dataDir,
  BUILD_PROFILE: "home-lan",
  GIT_COMMIT: commit,
  PORT: String(serverPort),
  VITE_SERVER_PORT: String(serverPort),
};
const children = [];
let shuttingDown = false;

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}
function alive(child) {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function start(label, args) {
  // Each child gets its own process group so we can stop pnpm *and* the
  // node process it spawns (vite-node / vite) with one signal — and so a
  // terminal Ctrl+C reaches them only through the handler below.
  const child = spawn("pnpm", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`\n[${label}] exited with code ${code}. Stopping the other process.`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping server and client…");
  for (const c of children) signalGroup(c, "SIGTERM");
  const deadline = Date.now() + 4000;
  const tick = () => {
    if (children.every((c) => !alive(c))) return process.exit(code);
    if (Date.now() > deadline) {
      for (const c of children) signalGroup(c, "SIGKILL");
      return setTimeout(() => process.exit(code), 200);
    }
    setTimeout(tick, 100);
  };
  tick();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("server", ["--filter", "@catan/server", "start"]);
start("client", ["--filter", "@catan/client", "dev", "--", "--host", "0.0.0.0", "--port", String(clientPort), "--strictPort"]);

const lans = lanAddresses();
setTimeout(() => {
  console.log("\n========================================================");
  console.log("  Players on this Wi-Fi open:");
  if (lans.length === 0) console.log("  (no LAN address found — are you connected to Wi-Fi?)");
  for (const l of lans) console.log(`    http://${l.address}:${clientPort}    (${l.name})`);
  console.log(`  This machine:  http://localhost:${clientPort}`);
  console.log(`  Game server:   ws://<same address>:${serverPort}`);
  console.log("  Ctrl+C stops both.");
  console.log("========================================================\n");
}, 2500);
