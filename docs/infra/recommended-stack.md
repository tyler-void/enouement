> Historical — describes the pre-2026-09-21 gateway scope.

# Infrastructure — Recommended Stack & Orchestration Contract

_Last updated: 2026-06-09. Decisive picks from the vendored-repo deep dive. Rationale in
[../research/new-sparks-2026.md](../research/new-sparks-2026.md)._

The gateway saves tokens via orthogonal layers — pick **one primary per layer**, keep heavier
options as opt-in escalation behind the same facade.

## The picks

| Layer | Pick | Why it wins | Escalation / alt |
|-------|------|-------------|------------------|
| **A. Tool-output compression** | **rtk** (wrap the binary) | Hard benchmarks (−80% session: 118k→23.9k), zero-dep Rust binary, 100+ commands, Apache-2.0. Category leader — 9router itself bundles it. | — |
| **B. Structural retrieval** | **codebase-memory-mcp** | Single static **C** binary, zero deps, **persistent on-disk SQLite graph** (queryable cold, no resident daemon), 159 langs, hardened distribution (cosign/SLSA-L3), sub-ms queries, ~3.4k vs ~412k tokens. Smallest footprint for a gateway that spawns it on demand. | **gortex** — add only when you need dataflow / blast-radius / call-chain depth or 257-lang coverage; costs a long-lived daemon + ~5 GB RAM |
| **C. Semantic retrieval** | **semble** | Pure-CPU, no key/GPU/network, *published* NDCG@10 0.854 / 250ms index / 1.5ms query / −98% vs grep, MIT. BM25+Model2Vec+RRF hybrid beats pure-dense for code identifiers. | cocoindex-code — only for teams standardized on a specific cloud embedding provider via LiteLLM |
| **Routing / fallback / quota** | **9router** (sit in front of it) | Already a production routing layer: OpenAI-compatible, tiered Subscription→Cheap→Free fallback, per-provider quota tracking, format translation, OAuth for major coding tools, 40+ providers, MIT, bundles rtk. Node — same runtime family as a Bun gateway. | LiteLLM for cache + per-request cost-aware selection it lacks |
| **Caching / proxy core** | **LiteLLM** (cache-aware layer) | Redis/disk/semantic caching, forwards Anthropic `cache_control`, OpenAI-compatible. The cache-passthrough + canonicalization layer (SPARK 0). | ⚠️ pin a known-good version (see security note) |
| **Output-style compression** | **caveman** fragment | Inject its terse-output preamble; cheap ~−65% output tokens. | — |
| **Edit application** | search-replace / unified-diff, validated by re-parse + re-run tests | Robust default; avoids silent 7B-apply corruption | Morph fast-apply *only* if cheap planner emits precise edit instructions |

**Net default footprint:** rtk (Rust, ~MB, per-call) + codebase-memory-mcp (C, on-disk SQLite,
cold-queryable) + semble (Python/uv, CPU-only, ~250ms index) + 9router (Node, already running)
+ LiteLLM. **No GPU, no API key required for the default path.** gortex/cocoindex are opt-in
heavier backends behind the same facade.

## How the layers compose

```
Agent ──MCP──▶ Eco-MCP Gateway (TS/Bun) ──HTTP──▶ 9router ──▶ providers
                  │  facade MCP tools: search_semantic, find_related,
                  │     query_structure, trace_path, impact_radius, run_command
                  │
                  ├─ run_command  ──▶ rtk (subprocess)                [Layer A]
                  ├─ query_structure/trace_path/impact ──▶ codebase-memory-mcp / gortex (MCP-stdio)  [Layer B]
                  ├─ search_semantic/find_related ──▶ semble (MCP-stdio / CLI)   [Layer C]
                  ├─ caching/canonicalization ──▶ LiteLLM cache-aware egress     [SPARK 0]
                  ├─ terse-output preamble (caveman fragment)                    [Layer A model-side]
                  └─ offload+stub large tool outputs to local store              [SPARK 2]
```

**Division of responsibility:** the gateway owns retrieval + compression + MCP facade +
caching/canonicalization + the small-model scaffolding loop (SPARK 1); **9router owns provider
routing/fallback/quota**. Point the gateway's outbound LLM calls at 9router's
`/v1/chat/completions`. Reimplement routing only for features 9router lacks (per-request
cost-aware model selection, phase-aware routing).

## Wrapper / orchestration contract

The gateway (TS/Bun) drives: Rust binary (rtk), C binary (codebase-memory-mcp), Go binary
(gortex), Python tools (semble, cocoindex). Two integration modes:

- **MCP subprocess (stdio)** — preferred for retrieval backends (they already speak MCP). The
  gateway is an MCP *client* spawning each as a stdio child, and re-exposes a curated, **renamed**
  subset through its own MCP server (facade). One stable tool namespace; swap
  codebase-memory↔gortex without the agent noticing.
- **Plain subprocess (exec + parse)** — for rtk (CLI, not MCP) and one-shot calls
  (`semble search`).

Every backend implements:

```ts
interface BackendAdapter {
  id: string;                          // "rtk" | "memory" | "gortex" | "semble" | "cocoindex"
  mode: "mcp-stdio" | "subprocess";
  ensureInstalled(): Promise<void>;    // verify binary/version + cosign/SHA-256; fail closed
  ensureIndexed(repo: string): Promise<void>;  // no-op for rtk; index/refresh for retrieval
  health(): Promise<"ok" | "degraded" | "down">;
  capabilities(): Capability[];        // ["structural.callgraph","semantic.search","output.compress",...]
  invoke(op: string, args: Record<string, unknown>): Promise<{
    content: string;                   // already-compressed payload for the model
    meta: { backend: string; tokensIn?: number; tokensOut: number; tokensSaved?: number; latencyMs: number };
  }>;
  dispose(): Promise<void>;            // kill child, flush snapshot
}
```

Rules:
1. **Spawn discipline** — `Bun.spawn({cmd, stdin:"pipe", stdout:"pipe"})`; MCP-stdio backends
   long-lived per repo (warm cache), subprocess backends per-call; hard timeouts + kill; never
   inherit gateway stdio.
2. **Install/verify gate** — `ensureInstalled` runs upstream install + verifies cosign/SHA-256
   (codebase-memory, gortex); fail closed.
3. **Index lifecycle** — track repo content hash; use each backend's change-detection
   (`detect_changes` / `--refresh` / cocoindex incremental) over full reindex.
4. **Facade naming** — gateway exposes a small fixed toolset; routes each to whichever adapter
   advertises the capability. Backend swap = config change.
5. **Token accounting** — every `invoke` returns `tokensSaved` so the gateway logs aggregate
   savings (the ROI-dashboard data for the pitch).
6. **LLM egress** — all outbound calls go through the cache-aware LiteLLM layer → 9router.

## Security notes (from the research)
- **LiteLLM**: known retry→fallback loop bug ([#19985](https://github.com/BerriAI/litellm/issues/19985))
  and a [2026 supply-chain compromise](https://www.trendmicro.com/en_gb/research/26/c/inside-litellm-supply-chain-compromise.html)
  — pin a vetted version, verify integrity, avoid the compromised releases.
- **Compression of untrusted content** (tickets, web, logs) is a **prompt-injection vector**
  (flagged on the Context Gateway HN thread). Treat compressed untrusted text as untrusted.
- All 7 vendored repos verified permissive: **MIT** (9router, caveman, codebase-memory-mcp,
  semble) / **Apache-2.0** (rtk, cocoindex-code, gortex). Keep upstream notices on anything we
  adapt. See [reference-repos.md](reference-repos.md).
