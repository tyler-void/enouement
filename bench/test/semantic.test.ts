// Offline tests for semble output parsing (no model download: uses fixtures/fake-semble.ts).
// Run: cd bench && bun run test

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseSembleResults, Semantic } from "../src/experiments/jev-rerank/semantic";

describe("semble output parsing", () => {
  const flat = JSON.stringify({
    query: "q",
    results: [{ file_path: "a.ts", start_line: 3, end_line: 9, score: 0.9, content: "const a = 1" }],
  });
  const nested = JSON.stringify({
    query: "q",
    results: [{ chunk: { file_path: "a.ts", start_line: 3, end_line: 9, content: "const a = 1", location: "a.ts:3-9" }, score: 0.9 }],
  });

  test("semble >= 0.4.0 flat shape", () => {
    expect(parseSembleResults(flat, 600)).toEqual([{ location: "a.ts:3-9", content: "const a = 1" }]);
  });
  test("semble <= 0.3.x nested shape", () => {
    expect(parseSembleResults(nested, 600)).toEqual([{ location: "a.ts:3-9", content: "const a = 1" }]);
  });
  test("'No results found.' payload → empty, not a crash", () => {
    expect(parseSembleResults(JSON.stringify({ error: "No results found." }), 600)).toEqual([]);
  });

  test("Semantic passes -k through (semble defaults to 5)", () => {
    process.env.ECO_SEMBLE_BIN = join(import.meta.dir, "fixtures", "fake-semble.ts");
    const got = new Semantic().searchRaw(".", "q", 7);
    expect(got).toHaveLength(7);
    expect(got!.every((c) => !c.location.includes("undefined") && c.content.length > 0)).toBe(true);
  });
});
