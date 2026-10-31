// `enou brief` latency at the design volume (tasks.md T055h, research.md §11).
//
// Builds a synthetic repository in a temp directory — 10,000 records over 20 declared modules and
// 2,000 source files, all committed to git — then times the brief command in-process (the CLI's own
// main(): store load, module resolution, git rename history, trailers and implementing commits;
// process start-up excluded) over 1, 10 and 100 paths. Prints the method, the machine and p50/p95.
//
//   bun bench/src/knowledge/brief-latency.ts [records=10000] [runs=15]
//
// Research code (Principle V): it measures, it does not ship.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../src/cli/main";
import { brief } from "../../../src/knowledge/brief";
import { createUlidFactory } from "../../../src/knowledge/id";
import { loadModules } from "../../../src/knowledge/modules";
import { loadStore } from "../../../src/knowledge/store";
import { serialiseRecord } from "../../../src/knowledge/record";

const RECORDS = Number(process.argv[2] ?? 10_000);
const RUNS = Number(process.argv[3] ?? 15);
const MODULES = 20;
const FILES_PER_MODULE = 100;
const KINDS = ["invariant", "gotcha", "convention", "decision"] as const;

function git(root: string, args: string[]) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "b", GIT_AUTHOR_EMAIL: "b@e.invalid", GIT_COMMITTER_NAME: "b", GIT_COMMITTER_EMAIL: "b@e.invalid" },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function build(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "enou-brief-bench-")));
  mkdirSync(join(root, ".knowledge", "records"), { recursive: true });
  mkdirSync(join(root, ".knowledge", "inbox"), { recursive: true });
  const mods = Array.from({ length: MODULES }, (_, m) => `src/m${String(m).padStart(2, "0")}`);
  writeFileSync(join(root, ".knowledge", "modules.yaml"), `modules:\n${mods.map((m) => `  - path: ${m}\n`).join("")}`);
  for (const m of mods) {
    mkdirSync(join(root, m), { recursive: true });
    for (let f = 0; f < FILES_PER_MODULE; f++) writeFileSync(join(root, m, `file${f}.ts`), `export const v${f} = ${f};\n`);
  }
  const next = createUlidFactory({ now: (() => { let t = 1_760_000_000_000; return () => (t += 1000); })() });
  for (let i = 0; i < RECORDS; i++) {
    const m = mods[i % MODULES]!;
    const f = Math.floor(i / MODULES) % FILES_PER_MODULE;
    const kind = KINDS[i % KINDS.length]!;
    const data: Record<string, unknown> = {
      id: next(),
      kind,
      summary: `synthetic ${kind} ${i} about ${m}/file${f}.ts`,
      provenance: { origin: "contemporaneous", date: "2026-10-31" },
      paths: [`${m}/file${f}.ts`],
      ...(kind === "decision" ? { rejected: ["the obvious alternative"] } : {}),
    };
    const body = `Record ${i}. ` + "Why this holds, and what breaks if it does not. ".repeat(5);
    writeFileSync(join(root, ".knowledge", "records", `${data.id}.md`), serialiseRecord(data, body));
  }
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "synthetic corpus"]);
  return root;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** The same brief with git skipped (no rename history, trailers or implementing commits) — to
 *  attribute the cost, not a configuration anyone runs. */
async function timeNoGit(root: string, paths: string[]): Promise<number> {
  const t0 = performance.now();
  const modules = loadModules(root);
  if (!modules.ok) throw new Error("modules");
  brief(root, loadStore(root), modules.config, paths, { noGit: true });
  return performance.now() - t0;
}

async function time(root: string, paths: string[]): Promise<number> {
  const t0 = performance.now();
  const code = await main(["brief", ...paths], { cwd: root, env: {}, out: () => {}, err: () => {}, stdin: () => "" });
  const ms = performance.now() - t0;
  if (code !== 0) throw new Error(`brief exited ${code}`);
  return ms;
}

const t0 = performance.now();
const root = build();
console.log(`built ${RECORDS} records over ${MODULES} modules / ${MODULES * FILES_PER_MODULE} files in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const files = Array.from({ length: 100 }, (_, i) => `src/m${String(i % MODULES).padStart(2, "0")}/file${Math.floor(i / MODULES)}.ts`);

console.log(`machine: ${cpus()[0]?.model} × ${cpus().length}, Linux ${release()}, bun ${process.versions.bun}`);
console.log(`method: in-process main(["brief", …paths]); 1 warm-up discarded; ${RUNS} timed runs per size (p95 of ${RUNS} runs is close to the maximum)`);
for (const [label, fn] of [["enou brief", time], ["same, git skipped", timeNoGit]] as const) {
  console.log(label);
  for (const n of [1, 10, 100]) {
    const paths = files.slice(0, n);
    await fn(root, paths);
    const samples: number[] = [];
    for (let r = 0; r < RUNS; r++) samples.push(await fn(root, paths));
    samples.sort((a, b) => a - b);
    console.log(`  paths=${String(n).padStart(3)}  p50 ${percentile(samples, 50).toFixed(0)} ms  p95 ${percentile(samples, 95).toFixed(0)} ms`);
  }
}
rmSync(root, { recursive: true, force: true });
