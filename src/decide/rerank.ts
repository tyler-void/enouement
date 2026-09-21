// Jev rerank for `retrieve`: turn semble's fixed top-k into an ADAPTIVE k.
//
// Why: our own benchmark (docs/research/benchmark-results.md) found naive top-k semantic
// chunks cost ~4× a scoped grep — k is a fixed budget whether or not the chunks help.
// Here semble over-fetches a pool, Jev answers one yes/no per chunk ("does this answer the
// query?"), and only chunks with p ≥ threshold are injected (≤ k). Fewer tokens when the
// query is sharp; still up to k when it's broad.
//
// Jev decides what enters context. The agent's model decides what it means.

import type { Chunk } from "../backends/semantic";
import type { Decider, NoulQuestion } from "./jev";

export interface RerankOpts {
  k: number; // max chunks returned
  threshold: number; // min P(relevant) to keep
  mode: "shared" | "pair"; // one request with all chunks | one request per chunk
  maxStateChars: number; // shared state above this switches to pair mode (32k-token state cap)
}

export const DEFAULT_RERANK: RerankOpts = { k: 3, threshold: 0.5, mode: "shared", maxStateChars: 80_000 };

export interface Ranked {
  chunk: Chunk;
  p: number | null; // null only in fallback (no signal — never pretend there is one)
}

export interface RerankOutcome {
  status: "ranked" | "low-confidence" | "fallback";
  kept: Ranked[];
  pool: number;
  mode: RerankOpts["mode"];
  ms: number;
  inputTokens: number;
  reason?: string;
}

// Jev reads instructions literally (docs: model-jaggedness/jev-1.13), so the criteria spell out
// what "relevant" excludes. It also treats data as trusted — a chunk can contain text aimed at
// the model; the worst case here is a wrong keep/drop, not an action.
function question(ref: string): NoulQuestion {
  return {
    type: "noul",
    instructions: `Is ${ref} code that a developer must read to answer \`query\`?`,
    criteria: {
      true: "It defines, implements, configures, or tests the specific thing the query asks about.",
      false: "It is unrelated, or it only mentions, imports, or re-exports that thing without the relevant logic.",
    },
  };
}

export async function rerankChunks(
  query: string,
  chunks: Chunk[],
  decider: Decider,
  opts: RerankOpts = DEFAULT_RERANK,
): Promise<RerankOutcome> {
  const t0 = performance.now();
  const base = { pool: chunks.length, ms: 0, inputTokens: 0 };
  if (!chunks.length) return { ...base, status: "ranked", kept: [], mode: opts.mode };

  const ids = chunks.map((_, i) => `c${i}`);
  const sharedState = {
    query,
    candidates: Object.fromEntries(chunks.map((c, i) => [ids[i], { location: c.location, content: c.content }])),
  };
  const mode: RerankOpts["mode"] =
    opts.mode === "shared" && JSON.stringify(sharedState).length > opts.maxStateChars ? "pair" : opts.mode;

  let probs: number[] | null = null;
  let inputTokens = 0;
  if (mode === "shared") {
    const r = await decider.noul(sharedState, Object.fromEntries(ids.map((id) => [id, question(`\`candidates.${id}\``)])));
    if (r) {
      probs = ids.map((id) => r.probs[id]!);
      inputTokens = r.inputTokens;
    }
  } else {
    // Each request sees only its own chunk: no distractors in state, at the cost of N requests.
    const rs = await Promise.all(
      chunks.map((c) => decider.noul({ query, candidate: { location: c.location, content: c.content } }, { rel: question("`candidate`") })),
    );
    if (rs.every((r) => r != null)) {
      probs = rs.map((r) => r!.probs.rel!);
      inputTokens = rs.reduce((a, r) => a + r!.inputTokens, 0);
    }
  }
  const ms = performance.now() - t0;

  if (!probs) {
    // Partial answers are discarded too: a missing score must not read as "irrelevant".
    return {
      ...base,
      ms,
      mode,
      status: "fallback",
      reason: `${decider.id} unavailable`,
      kept: chunks.slice(0, opts.k).map((chunk) => ({ chunk, p: null })),
    };
  }

  const ranked = chunks.map((chunk, i) => ({ chunk, p: probs![i]! })).sort((a, b) => b.p - a.p);
  const kept = ranked.filter((r) => r.p >= opts.threshold).slice(0, opts.k);
  if (!kept.length) {
    return { ...base, ms, mode, inputTokens, status: "low-confidence", kept: ranked.slice(0, 1) };
  }
  return { ...base, ms, mode, inputTokens, status: "ranked", kept };
}

const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000; // docs.typesafe.ai/models, 2026-09; output is free

export function outcomeNote(o: RerankOutcome, threshold: number): string {
  const cost = o.inputTokens ? `, ${o.inputTokens} input tok ≈ $${(o.inputTokens * USD_PER_INPUT_TOKEN).toFixed(6)}` : "";
  const timing = `${Math.round(o.ms)} ms${cost}`;
  switch (o.status) {
    case "fallback":
      return `[eco-mcp: jev rerank skipped (${o.reason}) — UNRANKED semble top-${o.kept.length}]`;
    case "low-confidence":
      return (
        `[eco-mcp: jev found no chunk with p≥${threshold} among ${o.pool}; showing best guess only ` +
        `(p=${o.kept[0]!.p!.toFixed(2)}) — try search_structure/find_concept · ${timing}]`
      );
    case "ranked":
      return `[eco-mcp: jev kept ${o.kept.length}/${o.pool} chunks (p≥${threshold}, ${o.mode}) · ${timing}]`;
  }
}
