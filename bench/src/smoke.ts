// Offline smoke test — NO API key required.
// Validates the harness mechanics by simulating a perfect agent: fixture copy, task setup,
// the known-correct action, success checks, the tools, and cost plumbing.

import { cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS } from "./tasks/suite";
import { buildToolKit } from "./agent/tools";
import { selectBackends } from "./agent/backends";
import { buildProfiles } from "./profiles";
import { costUSD } from "./metrics/cost";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "sample-app");
const TOOLS_DIR = join(__dirname, "..", ".tools");
const backends = selectBackends(TOOLS_DIR);

function fresh(): string {
  const d = mkdtempSync(join(tmpdir(), "ecosmoke-"));
  cpSync(FIXTURE, d, { recursive: true });
  return d;
}

let failures = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// 1. Tasks fail in their initial (unsolved) state.
{
  const wd = fresh();
  TASKS.find((t) => t.id === "fix-rounding")!.setup(wd);
  const c = await TASKS.find((t) => t.id === "fix-rounding")!.check(wd, "");
  ok("fix-rounding fails before fix", !c.pass, c.detail);
}
{
  const wd = fresh();
  TASKS.find((t) => t.id === "feature-discount")!.setup(wd);
  const c = await TASKS.find((t) => t.id === "feature-discount")!.check(wd, "");
  ok("feature-discount fails before feature", !c.pass, c.detail);
}

// 2. Perfect agent solves each task -> checks pass.
{
  const t = TASKS.find((t) => t.id === "navigate")!;
  const wd = fresh();
  await t.setup(wd);
  const c = await t.check(wd, "tax.ts:applyTax");
  ok("navigate passes with correct answer", c.pass, c.detail);
  const bad = await t.check(wd, "checkout.ts:checkout");
  ok("navigate rejects wrong answer", !bad.pass);
}
{
  const t = TASKS.find((t) => t.id === "fix-rounding")!;
  const wd = fresh();
  await t.setup(wd);
  const p = join(wd, "src/money.ts");
  writeFileSync(p, readFileSync(p, "utf8").replace("Math.trunc", "Math.round"));
  const c = await t.check(wd, "fixed");
  ok("fix-rounding passes after Math.round fix", c.pass, c.detail);
}
{
  const t = TASKS.find((t) => t.id === "feature-discount")!;
  const wd = fresh();
  await t.setup(wd);
  writeFileSync(
    join(wd, "src/discount.ts"),
    "export function applyDiscount(amount: number, pct: number): number {\n  return amount - amount * (pct / 100);\n}\n",
  );
  const c = await t.check(wd, "added");
  ok("feature-discount passes after creating discount.ts", c.pass, c.detail);
}

// 3. Tools work, and the gateway variants are more compact than baseline.
{
  const wd = fresh();
  const baseKit = buildToolKit(buildProfiles("anthropic")[0], backends); // A0: grep + raw tests
  const gwKit = buildToolKit(buildProfiles("anthropic")[3], backends); // A3: retrieve + compressed tests

  console.log(`  (backends: semantic=${backends.semanticId}, structural=${backends.structural ? "codebase-memory" : "off"})`);
  const rawGrep = baseKit.run({ id: "1", name: "grep", args: { pattern: "tax" } }, { workdir: wd });
  const retr = gwKit.run({ id: "2", name: "retrieve", args: { query: "apply tax rate to subtotal" } }, { workdir: wd });
  ok("grep returns matches", rawGrep.includes("tax"));
  ok("retrieve returns matches", retr.toLowerCase().includes("applytax") || retr.toLowerCase().includes("tax.ts"));
  if (backends.structural) {
    const struct = gwKit.run({ id: "2b", name: "query_structure", args: { name_pattern: ".*[Tt]ax.*" } }, { workdir: wd });
    ok("query_structure finds applyTax symbol", struct.toLowerCase().includes("applytax"), struct.slice(0, 80));
  }

  const rawRead = baseKit.run({ id: "3", name: "read_file", args: { path: "src/checkout.ts" } }, { workdir: wd });
  ok("read_file returns numbered lines", rawRead.includes("\t"));

  // make money test fail, compare raw vs compressed test output size
  TASKS.find((t) => t.id === "fix-rounding")!.setup(wd);
  const rawTests = baseKit.run({ id: "4", name: "run_tests", args: { file: "test/money.test.ts" } }, { workdir: wd });
  const compTests = gwKit.run({ id: "5", name: "run_tests", args: { file: "test/money.test.ts" } }, { workdir: wd });
  ok("compressed test output <= raw", compTests.length <= rawTests.length, `${compTests.length} vs ${rawTests.length} chars`);
}

// 4. Cost plumbing.
{
  const c = costUSD({ input: 10_000, cachedRead: 0, cacheWrite: 0, output: 1_000 }, "claude-sonnet-4-6");
  ok("cost calc non-zero", c > 0, `$${c.toFixed(5)} for 10k in / 1k out (sonnet)`);
  const cached = costUSD({ input: 0, cachedRead: 10_000, cacheWrite: 0, output: 1_000 }, "claude-sonnet-4-6");
  ok("cached input is cheaper than fresh", cached < c, `$${cached.toFixed(5)} cached vs $${c.toFixed(5)} fresh`);
}

console.log(`\n${failures === 0 ? "ALL SMOKE CHECKS PASSED" : failures + " SMOKE CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
