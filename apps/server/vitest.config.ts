import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Colyseus boots a real server per test file; keep it in-process so the
    // worker IPC isn't tangled with the socket traffic.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 10_000,
  },
});
