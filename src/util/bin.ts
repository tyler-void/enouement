// Locate the backend binaries (semble, codebase-memory-mcp), gracefully.

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

/** Default fallbacks that point at the binaries we already fetched for the benchmark. */
export function repoFallbacks(name: string): string[] {
  const home = process.env.HOME ?? "";
  return [
    join(process.cwd(), "bench", ".tools", name),
    join(home, ".local", "bin", name),
  ];
}

/** The workspace the agent is operating on. */
export function workspaceRoot(): string {
  return process.env.ECO_WORKSPACE || process.cwd();
}
