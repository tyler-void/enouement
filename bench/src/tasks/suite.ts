// Benchmark tasks against the self-contained sample app fixture.
// Post-audit hardening (2026-06-09):
//  - navigate is graded against the ACTUAL file (resolve the path the agent named, confirm it
//    defines the symbol), not a guessable substring of the prompt vocabulary.
//  - fix/feature RESTORE the graded test file from the pristine fixture before checking (the test
//    is the spec — the agent must not be able to pass by editing it), and assert the source
//    artifact actually changed.

import { rmSync, existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task, TaskCheck } from "../types";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "sample-app");

function rm(workdir: string, relPath: string) {
  const p = join(workdir, relPath);
  if (existsSync(p)) rmSync(p);
}

/** Restore a file from the pristine fixture (defeats the agent editing the graded test). */
function restorePristine(workdir: string, relPath: string) {
  const src = join(FIXTURE, relPath);
  const dest = join(workdir, relPath);
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

function read(workdir: string, relPath: string): string {
  const p = join(workdir, relPath);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function runTestFile(workdir: string, file: string): { pass: boolean; out: string } {
  const proc = Bun.spawnSync(["bun", "test", file], { cwd: workdir });
  const out = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`;
  // exit 0 AND the runner actually executed >=1 test (guards against a 0-tests-run green).
  const ranSomething = /\d+ pass|\d+ fail/.test(out);
  return { pass: proc.exitCode === 0 && ranSomething, out };
}

export const TASKS: Task[] = [
  {
    id: "navigate",
    type: "navigate",
    prompt:
      "Which file and function applies the tax rate to the subtotal? Answer like 'src/tax.ts:applyTax'.",
    setup: (workdir) => {
      rm(workdir, "test/money.test.ts");
      rm(workdir, "test/discount.test.ts");
    },
    check: (workdir, finalAnswer): TaskCheck => {
      const a = finalAnswer.toLowerCase();
      // 1) must name the symbol, 2) must name a .ts path that 3) resolves to a NON-test file
      //    in the workdir that actually defines applyTax. Guessing prompt vocab won't pass (3).
      if (!a.includes("applytax")) return { pass: false, detail: `answer didn't name applyTax: "${finalAnswer.slice(0, 100)}"` };
      const pathMatch = finalAnswer.match(/([\w./-]+\.ts)/);
      if (!pathMatch) return { pass: false, detail: "answer named no .ts file path" };
      let rel = pathMatch[1].replace(/^\.?\//, "");
      if (rel.includes(".test.")) return { pass: false, detail: "named a test file, not the source" };
      if (!existsSync(join(workdir, rel)) && existsSync(join(workdir, "src", rel))) rel = join("src", rel);
      const content = read(workdir, rel);
      const pass = content.includes("function applyTax") || content.includes("applyTax =");
      return { pass, detail: pass ? `verified ${rel} defines applyTax` : `${rel} does not define applyTax` };
    },
  },
  {
    id: "fix-rounding",
    type: "fix",
    prompt:
      "The rounding helper has a bug: it truncates instead of rounding to the nearest cent. Fix it so the money test passes.",
    setup: (workdir) => {
      rm(workdir, "test/discount.test.ts");
    },
    check: (workdir): TaskCheck => {
      restorePristine(workdir, "test/money.test.ts"); // agent cannot pass by editing the test
      const { pass } = runTestFile(workdir, "test/money.test.ts");
      // sanity: the source must actually have changed away from the truncation bug
      const fixedSource = !read(workdir, "src/money.ts").includes("Math.trunc");
      const ok = pass && fixedSource;
      return {
        pass: ok,
        detail: ok
          ? "money test passes AND Math.trunc removed from source"
          : `pass=${pass} sourceFixed=${fixedSource} (test restored from pristine before check)`,
      };
    },
  },
  {
    id: "feature-discount",
    type: "feature",
    prompt:
      "Add a percentage discount helper. Create src/discount.ts exporting applyDiscount(amount, pct) so the discount test passes (applyDiscount(100, 10) === 90).",
    setup: (workdir) => {
      rm(workdir, "test/money.test.ts");
    },
    check: (workdir): TaskCheck => {
      restorePristine(workdir, "test/discount.test.ts"); // agent cannot pass by editing the test
      const { pass } = runTestFile(workdir, "test/discount.test.ts");
      const hasImpl = /export\s+(function|const)\s+applyDiscount/.test(read(workdir, "src/discount.ts"));
      const ok = pass && hasImpl;
      return {
        pass: ok,
        detail: ok
          ? "discount test passes AND src/discount.ts exports applyDiscount"
          : `pass=${pass} hasImpl=${hasImpl} (test restored from pristine before check)`,
      };
    },
  },
];
