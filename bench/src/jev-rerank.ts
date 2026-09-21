// Jev rerank lever — does an adaptive k beat a fixed k on BOTH tokens and hit rate?
//
// Same 5 hono queries + targets as microbench.ts. Unlike microbench (size only), this also
// scores quality: hit = the target file is among the injected chunks.
//   baseline : semble top-k, k ∈ {1,3,5}              (fixed k, as a plain MCP would inject)
//   jev      : semble pool of POOL → Jev noul per chunk → keep p ≥ threshold, ≤ k=3
//
// Needs: semble on PATH (or SEMBLE/ECO_SEMBLE_BIN), the hono fixture, and for the jev arm
// TYPESAFE_API_KEY. Sends hono (public OSS) chunks to api.typesafe.ai — never point this at
// private code.
//   bun run src/jev-rerank.ts                  # baselines only
//   TYPESAFE_API_KEY=… bun run src/jev-rerank.ts
//   ECO_JEV_MODE=pair ECO_JEV_POOL=20 TYPESAFE_API_KEY=… bun run src/jev-rerank.ts

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer";
import { Semantic, formatChunks, type Chunk } from "./experiments/jev-rerank/semantic";
import { deciderFromEnv } from "./experiments/jev-rerank/jev";
import { DEFAULT_RERANK, rerankChunks } from "./experiments/jev-rerank/rerank";

const here = dirname(fileURLToPath(import.meta.url));
const HONO = join(here, "..", "fixtures", "oss", "hono");
const tok = (s: string) => encode(s).length;

// Kept identical to microbench.ts QUERIES (that module runs main() on import, so not imported).
const QUERIES = [
  { label: "cors", query: "CORS middleware configuration", target: "src/middleware/cors/index.ts" },
  { label: "jwt", query: "verify JWT token middleware", target: "src/middleware/jwt/jwt.ts" },
  { label: "basic-auth", query: "basic authentication middleware", target: "src/middleware/basic-auth/index.ts" },
  { label: "get-cookie", query: "read a cookie from the request", target: "src/helper/cookie/index.ts" },
  { label: "regexp-router", query: "RegExp based router implementation", target: "src/router/reg-exp-router/router.ts" },
];

const POOL = Number(process.env.ECO_JEV_POOL ?? 12);
const K = 3;
const hit = (cs: Chunk[], target: string) => cs.some((c) => c.location.includes(target));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function main() {
  if (!existsSync(HONO)) {
    console.error(`hono fixture missing:\n  git clone --depth 1 https://github.com/honojs/hono ${HONO}`);
    process.exit(1);
  }
  const semantic = new Semantic();
  if (!semantic.available()) {
    console.error("semble not found (uv tool install semble, or set ECO_SEMBLE_BIN)");
    process.exit(1);
  }
  const decider = deciderFromEnv({ ...process.env, ECO_JEV: "on" });
  const mode = process.env.ECO_JEV_MODE === "pair" ? "pair" : "shared";
  const threshold = Number(process.env.ECO_JEV_THRESHOLD ?? DEFAULT_RERANK.threshold);

  console.log(`# Jev rerank lever (hono, ${QUERIES.length} queries)\n`);
  console.log(`tokens = cl100k over the injected text · hit = target file among injected chunks`);
  console.log(decider ? `jev: ${decider.id}, pool ${POOL}, p≥${threshold}, max k=${K}, ${mode}\n` : `jev arm SKIPPED (no TYPESAFE_API_KEY)\n`);
  console.log(`| query | top-1 | top-3 | top-5 | jev (kept/pool) | jev ms |`);
  console.log(`|---|---|---|---|---|---|`);

  const tot = { k1: [0, 0], k3: [0, 0], k5: [0, 0], jev: [0, 0] }; // [tokens, hits]
  const jevMs: number[] = [];
  let jevInput = 0;
  let jevFallbacks = 0;

  for (const q of QUERIES) {
    const pool = semantic.searchRaw(HONO, q.query, Math.max(POOL, 5)) ?? [];
    const cell = (cs: Chunk[], acc: number[]) => {
      const t = tok(formatChunks(cs));
      const h = hit(cs, q.target);
      acc[0]! += t;
      acc[1]! += h ? 1 : 0;
      return `${t}${h ? " ✓" : " ✗"}`;
    };
    const row = [q.label, cell(pool.slice(0, 1), tot.k1), cell(pool.slice(0, 3), tot.k3), cell(pool.slice(0, 5), tot.k5)];
    if (decider) {
      const o = await rerankChunks(q.query, pool, decider, { ...DEFAULT_RERANK, k: K, threshold, mode });
      if (o.status === "fallback") jevFallbacks++;
      jevMs.push(o.ms);
      jevInput += o.inputTokens;
      row.push(`${cell(o.kept.map((r) => r.chunk), tot.jev)} (${o.kept.length}/${o.pool}${o.status === "ranked" ? "" : `, ${o.status}`})`);
      row.push(String(Math.round(o.ms)));
    } else row.push("—", "—");
    console.log(`| ${row.join(" | ")} |`);
  }

  const n = QUERIES.length;
  console.log(`\n| arm | tokens | hits |`);
  console.log(`|---|---|---|`);
  for (const [arm, [t, h]] of Object.entries(tot)) if (arm !== "jev" || decider) console.log(`| ${arm} | ${t} | ${h}/${n} |`);
  if (decider) {
    console.log(`\njev: median ${Math.round(median(jevMs))} ms/query · ${jevInput} input tok ≈ $${((jevInput * 0.042) / 1e6).toFixed(5)} total · fallbacks ${jevFallbacks}/${n}`);
    console.log(`Read it as: jev wins only if it matches top-3's hits with fewer tokens, or beats top-1's hits.`);
  }
  console.log(`\nN=${n}, one repo, one run. Directional, not a benchmark claim.`);
}

await main();
