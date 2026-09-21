// Offline unit tests: rerank logic with a scripted Decider.
// Run: cd bench && bun run test

import { describe, expect, test } from "bun:test";
import type { Chunk } from "../src/experiments/jev-rerank/semantic";
import { deciderFromEnv, type Decider, type NoulQuestion } from "../src/experiments/jev-rerank/jev";
import { DEFAULT_RERANK, outcomeNote, rerankChunks } from "../src/experiments/jev-rerank/rerank";

const chunks: Chunk[] = [
  { location: "src/index.ts:1-10", content: "export { Hono } from './hono'" },
  { location: "src/middleware/cors/index.ts:1-40", content: "export const cors = () => {}" },
  { location: "src/middleware/jwt/jwt.ts:1-30", content: "export const jwt = () => {}" },
  { location: "src/middleware/cors/index.test.ts:1-20", content: "describe('CORS', () => {})" },
];

/** Scores a chunk by a lookup on its location; records every request it receives. */
function scripted(scores: Record<string, number> | null) {
  const calls: { state: any; questions: Record<string, NoulQuestion> }[] = [];
  const d: Decider = {
    id: "scripted",
    async noul(state: any, questions) {
      calls.push({ state, questions });
      if (!scores) return null;
      const probs: Record<string, number> = {};
      for (const id of Object.keys(questions)) {
        const cand = state.candidates ? state.candidates[id] : state.candidate;
        probs[id] = scores[cand.location] ?? 0;
      }
      return { probs, inputTokens: 1000, ms: 5 };
    },
  };
  return { d, calls };
}

describe("rerankChunks", () => {
  test("keeps only chunks above threshold, best first, capped at k", async () => {
    const { d, calls } = scripted({
      "src/middleware/cors/index.ts:1-40": 0.94,
      "src/middleware/cors/index.test.ts:1-20": 0.61,
      "src/index.ts:1-10": 0.2,
      "src/middleware/jwt/jwt.ts:1-30": 0.05,
    });
    const o = await rerankChunks("CORS middleware", chunks, d, { ...DEFAULT_RERANK, k: 3 });
    expect(o.status).toBe("ranked");
    expect(o.kept.map((r) => r.chunk.location)).toEqual([
      "src/middleware/cors/index.ts:1-40",
      "src/middleware/cors/index.test.ts:1-20",
    ]);
    expect(calls).toHaveLength(1); // shared mode: one request for the whole pool
    expect(Object.keys(calls[0]!.questions)).toEqual(["c0", "c1", "c2", "c3"]);
  });

  test("k caps the result even when more chunks pass", async () => {
    const { d } = scripted(Object.fromEntries(chunks.map((c) => [c.location, 0.9])));
    const o = await rerankChunks("q", chunks, d, { ...DEFAULT_RERANK, k: 2 });
    expect(o.kept).toHaveLength(2);
  });

  test("nothing passes → single best guess, flagged low-confidence", async () => {
    const { d } = scripted({ "src/middleware/jwt/jwt.ts:1-30": 0.3 });
    const o = await rerankChunks("q", chunks, d);
    expect(o.status).toBe("low-confidence");
    expect(o.kept.map((r) => r.chunk.location)).toEqual(["src/middleware/jwt/jwt.ts:1-30"]);
    expect(outcomeNote(o, 0.5)).toContain("best guess");
  });

  test("decider failure → unranked top-k, p=null, and the note says so", async () => {
    const { d } = scripted(null);
    const o = await rerankChunks("q", chunks, d, { ...DEFAULT_RERANK, k: 3 });
    expect(o.status).toBe("fallback");
    expect(o.kept.map((r) => r.chunk)).toEqual(chunks.slice(0, 3));
    expect(o.kept.every((r) => r.p === null)).toBe(true);
    expect(outcomeNote(o, 0.5)).toContain("UNRANKED");
  });

  test("pair mode: one request per chunk, each state holds only its own chunk", async () => {
    const { d, calls } = scripted({ "src/middleware/cors/index.ts:1-40": 0.9 });
    const o = await rerankChunks("q", chunks, d, { ...DEFAULT_RERANK, mode: "pair" });
    expect(calls).toHaveLength(chunks.length);
    expect(calls.every((c) => c.state.candidate && !c.state.candidates)).toBe(true);
    expect(o.kept.map((r) => r.chunk.location)).toEqual(["src/middleware/cors/index.ts:1-40"]);
    expect(o.inputTokens).toBe(1000 * chunks.length);
  });

  test("pair mode: one failed request discards the whole ranking", async () => {
    let n = 0;
    const d: Decider = {
      id: "flaky",
      async noul() {
        return ++n === 2 ? null : { probs: { rel: 0.9 }, inputTokens: 10, ms: 1 };
      },
    };
    const o = await rerankChunks("q", chunks, d, { ...DEFAULT_RERANK, mode: "pair" });
    expect(o.status).toBe("fallback");
  });

  test("oversized shared state switches to pair mode", async () => {
    const big = chunks.map((c) => ({ ...c, content: "x".repeat(30_000) }));
    const { d, calls } = scripted({});
    const o = await rerankChunks("q", big, d, DEFAULT_RERANK);
    expect(o.mode).toBe("pair");
    expect(calls).toHaveLength(big.length);
  });
});

describe("deciderFromEnv", () => {
  test("a key alone does not enable it", () => {
    expect(deciderFromEnv({ TYPESAFE_API_KEY: "k" })).toBeNull();
  });
  test("ECO_JEV=on without a key stays off", () => {
    expect(deciderFromEnv({ ECO_JEV: "on" })).toBeNull();
  });
  test("on + key → pinned model by default", () => {
    expect(deciderFromEnv({ ECO_JEV: "on", TYPESAFE_API_KEY: "k" })?.id).toBe("jev-1.13.0");
  });
});
