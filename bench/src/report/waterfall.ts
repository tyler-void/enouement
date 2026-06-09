// Report generator — post-audit rewrite for statistical honesty:
//  - Aggregates per (profile × task), NOT pooled across heterogeneous tasks.
//  - Suite total = SUM of per-task medians (paired by task), so the headline isn't a median over
//    unlike cost distributions.
//  - Shows dispersion (min–max) and per-cell N — never a bare point estimate.
//  - Pass rate counts errored runs as failures (errors are not missing-at-random); errored count
//    shown separately.
//  - Effective $/success uses MEAN cost per attempt ÷ pass rate (a valid expected-cost estimator),
//    not median ÷ probability.
//  - Banners: whether BENCH_MODEL pinned the model (model-swap rung inert), and the Gemini
//    caching caveat.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { totalTokens } from "../metrics/cost";
import type { Profile, RunResult } from "../types";

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface Cell {
  ok: RunResult[]; // non-errored
  errored: number;
  attempts: number;
  passes: number;
}

function cell(results: RunResult[], pid: string, tid: string): Cell {
  const all = results.filter((r) => r.profileId === pid && r.taskId === tid);
  const ok = all.filter((r) => !r.error);
  return { ok, errored: all.length - ok.length, attempts: all.length, passes: all.filter((r) => r.pass).length };
}

export function renderReport(results: RunResult[], profiles: Profile[]): string {
  const tasks = [...new Set(results.map((r) => r.taskId))];
  const base = profiles[0];
  const L: string[] = [];

  L.push("# Eco-MCP Benchmark — ROI Report\n");
  L.push(`Generated ${new Date().toISOString()} · ${results.length} runs.`);

  // banners
  const models = new Set(profiles.map((p) => p.model));
  if (process.env.BENCH_MODEL || (profiles.length > 1 && models.size === 1)) {
    L.push(`\n> ⚠️ **Single model pinned** (\`${[...models].join(", ")}\`). The A5 "cheap-model routing" rung is **inert** — its delta vs A4 is meaningless here. Model-routing savings are a per-token PRICE effect; measure them with distinct premium/cheap models.`);
  } else {
    L.push(`\n> ⚠️ The A5→A4 delta is a per-token **price effect** (cheaper model), not token efficiency — read it as such.`);
  }
  if (base?.provider === "gemini") {
    L.push(`> ⚠️ **Gemini caching is N/A here**: the OpenAI-compat endpoint may not report cache reads for short turns, so the A0→A1 caching delta is not reliably measured on Gemini. Measure caching on Anthropic.`);
  }
  L.push(`> Per-run token usage is highly variable (Bai et al.: up to 30×) — dispersion (min–max) and N are shown; treat any delta within overlapping ranges as noise.\n`);

  // suite totals per profile (sum of per-task medians — robust to task heterogeneity)
  const suite = profiles.map((p) => {
    let cost = 0, toks = 0, attempts = 0, passes = 0, errored = 0;
    const meanCosts: number[] = [];
    for (const t of tasks) {
      const c = cell(results, p.id, t);
      cost += median(c.ok.map((r) => r.costUSD));
      toks += median(c.ok.map((r) => totalTokens(r.usage)));
      attempts += c.attempts;
      passes += c.passes;
      errored += c.errored;
      meanCosts.push(...c.ok.map((r) => r.costUSD));
    }
    const passRate = attempts ? passes / attempts : 0; // errors count as fail
    const effCost = passRate > 0 ? mean(meanCosts) / passRate : Infinity;
    return { p, cost, toks, attempts, passes, errored, passRate, effCost };
  });
  const baseCost = suite[0]?.cost ?? 0;
  const pct = (v: number, b: number) => (b > 0 ? `${Math.round(((b - v) / b) * 100)}%` : "—");

  L.push("## Suite totals per profile (sum of per-task medians)\n");
  L.push("| Profile | Model | Suite $ | vs A0 | Suite tokens | Pass (err-as-fail) | Errored |");
  L.push("|---|---|---|---|---|---|---|");
  for (const s of suite) {
    L.push(
      `| **${s.p.id}** ${s.p.label} | ${s.p.model} | $${s.cost.toFixed(5)} | ${pct(s.cost, baseCost)} | ` +
        `${s.toks.toLocaleString()} | ${s.passes}/${s.attempts} (${Math.round(s.passRate * 100)}%) | ${s.errored} |`,
    );
  }
  L.push("");

  // per-task breakdown with dispersion
  L.push("## Per-task cost: median [min–max] (N) — dispersion shown\n");
  L.push(`| Task | ${profiles.map((p) => p.id).join(" | ")} |`);
  L.push(`|---|${profiles.map(() => "---").join("|")}|`);
  for (const t of tasks) {
    const cells = profiles.map((p) => {
      const c = cell(results, p.id, t);
      if (!c.ok.length) return c.errored ? `err×${c.errored}` : "—";
      const costs = c.ok.map((r) => r.costUSD);
      const md = median(costs), mn = Math.min(...costs), mx = Math.max(...costs);
      return `$${md.toFixed(4)} [${mn.toFixed(4)}–${mx.toFixed(4)}] (n${c.ok.length})`;
    });
    L.push(`| ${t} | ${cells.join(" | ")} |`);
  }
  L.push("");

  // waterfall on suite totals
  L.push("## Savings waterfall (suite $ vs A0)\n```");
  const maxC = Math.max(...suite.map((s) => s.cost), 1e-9);
  for (const s of suite) {
    const bar = "█".repeat(Math.max(Math.round((s.cost / maxC) * 36), s.cost > 0 ? 1 : 0));
    L.push(`${s.p.id.padEnd(3)} $${s.cost.toFixed(5)} ${bar.padEnd(36)} ${pct(s.cost, baseCost)} saved`);
  }
  L.push("```\n");

  L.push("## Expected cost per successful suite-run\n");
  L.push("| Profile | Pass rate | Mean $/attempt | Eff $/success |");
  L.push("|---|---|---|---|");
  for (const s of suite) {
    L.push(
      `| ${s.p.id} | ${Math.round(s.passRate * 100)}% | $${mean(tasks.flatMap((t) => cell(results, s.p.id, t).ok.map((r) => r.costUSD))).toFixed(5)} | ` +
        `${isFinite(s.effCost) ? "$" + s.effCost.toFixed(5) : "n/a"} |`,
    );
  }
  L.push("\n> Eff $/success = mean cost per attempt ÷ pass rate (failed attempts included in the numerator). A profile that's cheap but fails more shows a higher effective cost.");

  return L.join("\n");
}

// CLI: load the most recent results JSON and print the report.
if (import.meta.main) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "results");
  const files = readdirSync(dir).filter((f) => f.startsWith("results-") && f.endsWith(".json")).sort();
  if (!files.length) {
    console.error("No results-*.json in results/. Run `bun run bench` first.");
    process.exit(1);
  }
  const latest = JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
  console.log(renderReport(latest.results, latest.profiles));
}
