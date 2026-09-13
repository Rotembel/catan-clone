import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reachable from other devices on the LAN, so friends can join by IP.
    host: true,
  },
});
