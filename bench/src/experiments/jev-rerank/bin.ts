// Locate the semble binary, gracefully. Moved here from src/util/bin.ts when the retrieval
// work left the product: the server no longer shells out to anything.

import { existsSync } from "node:fs";
import { join } from "node:path";

export function which(bin: string): string | null {
  const p = Bun.spawnSync(["sh", "-c", `command -v ${bin} || true`]);
  const out = p.stdout?.toString().trim();
  return out || null;
}

/** env override → on PATH → known fallbacks. Returns null if not found. */
export function resolveBin(envVar: string, name: string, fallbacks: string[] = []): string | null {
  const env = process.env[envVar];
  if (env && existsSync(env)) return env;
  const onPath = which(name);
  if (onPath) return onPath;
  for (const f of fallbacks) if (existsSync(f)) return f;
  return null;
}

/** Binaries already fetched for the benchmark — cwd may be the repo root or bench/. */
export function repoFallbacks(name: string): string[] {
  const home = process.env.HOME ?? "";
  return [
    join(process.cwd(), "bench", ".tools", name),
    join(process.cwd(), ".tools", name),
    join(home, ".local", "bin", name),
  ];
}
