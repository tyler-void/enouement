// Loads .env from the repo root and bench/ into process.env (without overwriting existing
// vars). Bun only auto-loads .env from its project root (bench/), so the repo-root .env that
// holds GEMINI_API_KEY would otherwise be missed. Import this for side effects before reading keys.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function load(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

load(join(here, "..", "..", ".env")); // repo root (GEMINI_API_KEY lives here)
load(join(here, "..", ".env")); // bench/.env (optional override)
