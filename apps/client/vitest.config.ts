import { defineConfig } from "vitest/config";

// The client's logic lives in the engine (which is tested there); UI tests
// come with the Phase 3 reconnection work. Keep `pnpm test` green meanwhile.
export default defineConfig({ test: { passWithNoTests: true } });
