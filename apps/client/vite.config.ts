import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Reachable from other devices on the LAN, so friends can join by IP.
    host: true,
    // Vite blocks unknown Host headers (DNS-rebinding guard); the host's
    // Bonjour name (`<laptop>.local`) must be allowed or it answers 403.
    allowedHosts: [".local"],
  },
});
