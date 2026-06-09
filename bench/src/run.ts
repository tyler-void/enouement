// Orchestrator: runs every (profile × task × repeat) and writes a results JSON,
// then prints the report.

import "./env"; // load repo-root .env (GEMINI_API_KEY) before reading keys
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { runAgent } from "./agent/loop";
import { makeClient } from "./agent/llm";
import { selectBackends } from "./agent/backends";
import { buildProfiles, detectProvider } from "./profiles";
import { getSuite } from "./tasks";
import { costUSD } from "./metrics/cost";
import type { RunResult } from "./types";
import { renderReport } from "./report/waterfall";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "..", "results");
const TOOLS_DIR = join(__dirname, "..", ".tools");

const RUNS = Number(process.env.BENCH_RUNS ?? 3);

function workdirFor(fixtureDir: string, copyPerRun: boolean): string {
  if (!copyPerRun) return fixtureDir; // read-only suite: run in place, reuse indexes
  const dir = mkdtempSync(join(tmpdir(), "ecobench-"));
  cpSync(fixtureDir, dir, {
    recursive: true,
    filter: (s) => !s.includes("/.git") && !s.includes("/node_modules"),
  });
  return dir;
}

async function main() {
  const provider = detectProvider();
  const profiles = buildProfiles(provider);
  const onlyProfiles = process.env.BENCH_PROFILES?.split(",");
  const active = onlyProfiles ? profiles.filter((p) => onlyProfiles.includes(p.id)) : profiles;
  const backends = selectBackends(TOOLS_DIR);
  const suite = getSuite(process.env.BENCH_SUITE ?? "sample-app");

  console.log(`Suite: ${suite.id} | provider: ${provider} | profiles: ${active.map((p) => p.id).join(",")} | runs/each: ${RUNS}`);
  console.log(
    `Backends: semantic=${backends.semanticId} structural=${backends.structural ? "codebase-memory" : "off"}`,
  );
  console.log(`Tasks: ${suite.tasks.map((t) => t.id).join(", ")}\n`);

  const results: RunResult[] = [];

  for (const profile of active) {
    const client = makeClient(profile.provider, profile.model);
    for (const task of suite.tasks) {
      for (let r = 1; r <= RUNS; r++) {
        const workdir = workdirFor(suite.fixtureDir, suite.copyPerRun);
        await task.setup(workdir);
        const t0 = performance.now();
        let res: RunResult;
        try {
          const outcome = await runAgent(task, profile, client, workdir, backends);
          const check = await task.check(workdir, outcome.finalAnswer);
          res = {
            taskId: task.id,
            profileId: profile.id,
            run: r,
            pass: check.pass,
            checkDetail: check.detail,
            usage: outcome.usage,
            costUSD: costUSD(outcome.usage, profile.model),
            turns: outcome.turns,
            wallMs: Math.round(performance.now() - t0),
          };
        } catch (e) {
          res = {
            taskId: task.id,
            profileId: profile.id,
            run: r,
            pass: false,
            checkDetail: "error",
            usage: { input: 0, cachedRead: 0, cacheWrite: 0, output: 0 },
            costUSD: 0,
            turns: 0,
            wallMs: Math.round(performance.now() - t0),
            error: (e as Error).message,
          };
        }
        results.push(res);
        console.log(
          `${profile.id} ${task.id} #${r}: ${res.pass ? "PASS" : "FAIL"} | ` +
            `$${res.costUSD.toFixed(5)} | ${res.turns} turns | ${res.wallMs}ms` +
            (res.error ? ` | ${res.error}` : ""),
        );
      }
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `results-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ provider, profiles: active, results }, null, 2));

  const report = renderReport(results, active);
  const mdPath = join(RESULTS_DIR, `report-${stamp}.md`);
  writeFileSync(mdPath, report);

  console.log("\n" + report);
  console.log(`\nResults: ${jsonPath}\nReport:  ${mdPath}`);
}

main();
