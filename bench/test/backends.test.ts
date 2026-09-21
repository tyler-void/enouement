// Offline tests for the benchmark's semble backend — the thing that decides whether the
// microbench's "retrieve chunks (semble)" column is a real measurement or a row of zeros.
// Uses fixtures/fake-semble.ts via SEMBLE_BIN, so no model download.
// Run: cd bench && bun run test

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SembleBackend } from "../src/agent/backends";

const FAKE = join(import.meta.dir, "fixtures", "fake-semble.ts");

function search(shape: "flat" | "nested", k?: number): string {
  process.env.SEMBLE_BIN = FAKE;
  process.env.FAKE_SEMBLE_SHAPE = shape;
  return new SembleBackend().search("CORS middleware", "/tmp", k);
}

describe("SembleBackend.search", () => {
  // The bug this covers: reading only `r.chunk` against semble >= 0.4.0's flat results made
  // every chunk "// undefined" with empty content, so the microbench measured ~0 tokens for
  // retrieval and the comparison was meaningless.
  test("semble >= 0.4.0 flat shape → real content, not undefined", () => {
    const out = search("flat", 3);
    expect(out).not.toContain("undefined");
    expect(out).toContain("src/middleware/cors/index.ts:1-40");
    expect(out).toContain("Access-Control-Allow-Origin");
  });

  test("semble <= 0.3.x nested shape still parses", () => {
    const out = search("nested", 3);
    expect(out).not.toContain("undefined");
    expect(out).toContain("src/middleware/cors/index.ts:1-40");
    expect(out).toContain("Access-Control-Allow-Origin");
  });

  test("-k is passed through (semble defaults to 5, so k=7 was capped)", () => {
    expect(search("flat", 7).split("\n\n")).toHaveLength(7);
    expect(search("flat", 2).split("\n\n")).toHaveLength(2);
  });

  test("unparseable output → empty string, not a crash", () => {
    process.env.SEMBLE_BIN = "/bin/true";
    expect(new SembleBackend().search("q", "/tmp", 3)).toBe("");
  });
});
