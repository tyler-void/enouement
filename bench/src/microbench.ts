// Deterministic lever micro-benchmark — NO LLM, not rate-limited, reproducible.
//
// Post-audit (2026-06-09) this was tightened for fairness:
//  - REAL tokenizer (gpt-tokenizer / cl100k), not chars/4. Approximate for non-OpenAI models
//    but far better than chars/4; raw bytes also reported (objective).
//  - REALISTIC grep baseline: scoped to src/ (excludes tests/docs/json), word-boundary match,
//    capped to a head like a real grep tool — not every substring hit repo-wide.
//  - FAIR retrieval side: measures semble's ACTUAL retrieved chunk content (what a production
//    MCP injects), not a one-line signature. So "retrieve" vs "read whole file" is like-for-like
//    (both can actually answer), and the % is honest rather than locator-vs-document.
//
// It measures injected-context SIZE, not retrieval answer-quality. State that when quoting.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "gpt-tokenizer";
import { selectBackends } from "./agent/backends";

const here = dirname(fileURLToPath(import.meta.url));
const HONO = join(here, "..", "fixtures", "oss", "hono");
const TOOLS = join(here, "..", ".tools");

const tok = (s: string) => encode(s).length; // cl100k; approx for Gemini/Claude
const GREP_LINE_CAP = 60; // a real grep/rg tool head-limits output

function srcFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      // realistic baseline: source only, exclude tests/specs (and non-code)
      else if (/\.(ts|tsx|js|jsx)$/.test(e) && !/\.(test|spec)\./.test(e)) out.push(p);
    }
  };
  walk(join(root, "src"));
  return out;
}

// Realistic grep: word-boundary match, src only, capped head (what an agent's grep tool returns).
function grepTokens(keyword: string): number {
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const hits: string[] = [];
  for (const f of srcFiles(HONO)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (re.test(l) && hits.length < GREP_LINE_CAP) hits.push(`${relative(HONO, f)}:${i + 1}: ${l}`);
    });
    if (hits.length >= GREP_LINE_CAP) break;
  }
  return tok(hits.join("\n"));
}

function readFileTokens(relPath: string): number {
  const p = join(HONO, relPath);
  return existsSync(p) ? tok(readFileSync(p, "utf8")) : 0;
}

interface Q {
  label: string;
  query: string;
  keyword: string;
  pattern: string;
  target: string;
}

const QUERIES: Q[] = [
  { label: "cors", query: "CORS middleware configuration", keyword: "cors", pattern: "^cors$", target: "src/middleware/cors/index.ts" },
  { label: "jwt", query: "verify JWT token middleware", keyword: "jwt", pattern: "^jwt$", target: "src/middleware/jwt/jwt.ts" },
  { label: "basic-auth", query: "basic authentication middleware", keyword: "basicAuth", pattern: "^basicAuth$", target: "src/middleware/basic-auth/index.ts" },
  { label: "get-cookie", query: "read a cookie from the request", keyword: "getCookie", pattern: "^getCookie$", target: "src/helper/cookie/index.ts" },
  { label: "regexp-router", query: "RegExp based router implementation", keyword: "RegExpRouter", pattern: "RegExpRouter", target: "src/router/reg-exp-router/router.ts" },
];

function main() {
  if (!existsSync(HONO)) {
    console.error(`hono fixture missing; clone it:\n  git clone --depth 1 https://github.com/honojs/hono ${HONO}`);
    process.exit(1);
  }
  const backends = selectBackends(TOOLS);
  console.log(`# Retrieval & Compression Lever Micro-benchmark (hono, deterministic)\n`);
  console.log(`Backends: semantic=${backends.semanticId}, structural=${backends.structural ? "codebase-memory" : "off"}`);
  console.log(`Tokens via gpt-tokenizer (cl100k; approximate for Gemini/Claude). No LLM calls.`);
  console.log(`grep = scoped to src/, word-boundary, head-capped ${GREP_LINE_CAP} lines (realistic). retrieve = semble's actual top-k chunks.\n`);

  console.log("## Per query — tokens injected to answer\n");
  console.log("| Query | grep-only (locate) | grep+read whole file (comprehension) | retrieve chunks (semble) | query_structure (cbm) |");
  console.log("|---|---|---|---|---|");

  const rows: { grep: number; gr: number; retr: number; struct: number }[] = [];
  for (const q of QUERIES) {
    const grep = grepTokens(q.keyword);
    const file = readFileTokens(q.target);
    const grepRead = grep + file;
    const retr = tok(backends.semantic.search(q.query, HONO));
    const struct = backends.structural ? tok(backends.structural.search(q.pattern, HONO)) : 0;
    rows.push({ grep, gr: grepRead, retr, struct });
    console.log(`| ${q.label} | ${grep} | ${grepRead} | ${retr} | ${struct || "—"} |`);
  }

  const sum = (f: (r: (typeof rows)[0]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totGrep = sum((r) => r.grep);
  const totGR = sum((r) => r.gr);
  const totRetr = sum((r) => r.retr);
  const totStruct = sum((r) => r.struct);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((1 - a / b) * 100)}%` : "—");

  console.log(`\n## Totals across ${QUERIES.length} queries (real tokens)\n`);
  console.log("| Approach | Tokens | vs grep+read | vs grep-only |");
  console.log("|---|---|---|---|");
  console.log(`| grep-only (locate) | ${totGrep} | ${pct(totGrep, totGR)} | 0% |`);
  console.log(`| grep + read whole file (comprehension) | ${totGR} | 0% | — |`);
  console.log(`| retrieve chunks (semble) | ${totRetr} | **${pct(totRetr, totGR)}** | ${pct(totRetr, totGrep)} |`);
  if (totStruct) console.log(`| query_structure (codebase-memory) | ${totStruct} | **${pct(totStruct, totGR)}** | ${pct(totStruct, totGrep)} |`);

  console.log(`\n**Honest reading:**`);
  console.log(`- vs reading whole files (comprehension): retrieve −${pct(totRetr, totGR).replace("%", "")}%, structural −${pct(totStruct, totGR).replace("%", "")}% — the real win, since both sides can actually answer (retrieve returns the live chunk content, not a locator).`);
  console.log(`- vs scoped grep (location only): retrieve −${pct(totRetr, totGrep).replace("%", "")}% — grep is already compact for plain location; the gateway's edge there is smaller. Stated honestly.`);

  console.log(`\n## Test-output compression lever (sample-app)\n`);
  console.log(`> Single failing-test sample — small absolute size, illustrative not representative.`);
  const APP = join(here, "..", "fixtures", "sample-app");
  const proc = Bun.spawnSync(["bun", "test", "test/money.test.ts"], { cwd: APP });
  const raw = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`.trim();
  const compressed = raw
    .split("\n")
    .filter((l) => /(fail|error|expect|received|throw|✗|✘|\d+ pass|\d+ fail|cannot find|TypeError|ReferenceError)/i.test(l))
    .join("\n");
  console.log("| Output | bytes | tokens |");
  console.log("|---|---|---|");
  console.log(`| raw \`bun test\` | ${raw.length} | ${tok(raw)} |`);
  console.log(`| failures-only compressed | ${compressed.length} | ${tok(compressed)} |`);
  console.log(`\nReduction: **${pct(compressed.length, raw.length)}** (bytes) on this test. Filter keeps Expected AND Received lines (diagnostic-preserving).`);
}

main();
