// plan.md binding test #13 — tasks.md T016: no file outside src/knowledge/platform.ts references a
// `Bun.*` global. Enforced by a scan, not a review convention: the seam is worthless the first time
// it is quietly bypassed.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const SEAM = "knowledge/platform.ts";
const BUN_GLOBAL = /\bBun\s*\./;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("only the platform seam touches Bun.*", () => {
  const files = walk(SRC).map((p) => relative(SRC, p).split("\\").join("/"));
  expect(files).toContain(SEAM);
  const offenders = files.filter((f) => f !== SEAM && BUN_GLOBAL.test(readFileSync(join(SRC, f), "utf8")));
  expect(offenders).toEqual([]);
});

test("the scan would catch an offender", () => {
  expect(BUN_GLOBAL.test(readFileSync(join(SRC, SEAM), "utf8"))).toBe(true);
});
