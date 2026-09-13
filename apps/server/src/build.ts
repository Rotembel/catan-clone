// Build identity (docs/planning/HOME_LAN_VERSION_WRAP.md §2): shown at
// startup, sent to every lobby, stored with every match record.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAPGEN_VERSION } from "@catan/rulesets";
import type { BuildInfo } from "@catan/shared";

const PROFILES: BuildInfo["buildProfile"][] = ["dev", "home-lan", "production"];

export function readBuildInfo(): BuildInfo {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  let appVersion = "0.0.0";
  try {
    appVersion = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: string }).version ?? appVersion;
  } catch {
    // keep the fallback
  }
  let gitCommit = process.env.GIT_COMMIT ?? "";
  if (!gitCommit) {
    try {
      gitCommit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      gitCommit = "unknown";
    }
  }
  const profile = process.env.BUILD_PROFILE ?? "dev";
  const buildProfile = (PROFILES as string[]).includes(profile) ? (profile as BuildInfo["buildProfile"]) : "dev";
  return { appVersion, gitCommit, buildProfile, mapGenerationVersion: MAPGEN_VERSION };
}

export function describeBuild(b: BuildInfo): string {
  return `${b.appVersion} (${b.gitCommit}) profile=${b.buildProfile} mapgen=${b.mapGenerationVersion}`;
}
