import { describe, expect, it } from "vitest";
import { deriveServerUrl } from "../src/net.js";

describe("deriveServerUrl", () => {
  it("follows the page's own hostname, so localhost and the LAN IP both work", () => {
    expect(deriveServerUrl({ protocol: "http:", hostname: "localhost" }, {})).toBe("ws://localhost:2567");
    expect(deriveServerUrl({ protocol: "http:", hostname: "192.168.1.212" }, {})).toBe("ws://192.168.1.212:2567");
  });

  it("uses wss on https pages", () => {
    expect(deriveServerUrl({ protocol: "https:", hostname: "catan.example" }, {})).toBe("wss://catan.example:2567");
  });

  it("honours VITE_SERVER_PORT and lets VITE_SERVER_URL override everything", () => {
    expect(deriveServerUrl({ protocol: "http:", hostname: "10.0.0.5" }, { VITE_SERVER_PORT: "3001" })).toBe("ws://10.0.0.5:3001");
    expect(
      deriveServerUrl({ protocol: "http:", hostname: "localhost" }, { VITE_SERVER_URL: "wss://catan.fly.dev", VITE_SERVER_PORT: "9" })
    ).toBe("wss://catan.fly.dev");
  });
});
