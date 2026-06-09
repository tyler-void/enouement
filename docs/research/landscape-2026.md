# Research — Coding-LLM Cost-Cutting Landscape (mid-2026)

_Last updated: 2026-06-09._

A survey of the niche tools, repos, and techniques actively attacking coding-LLM cost in
2026 — triggered by the Copilot pricing shock
([copilot-pricing-shock.md](copilot-pricing-shock.md)). Grouped by the lever they pull.
Repos we plan to clone/vendor are tracked with license notes in
[../infra/reference-repos.md](../infra/reference-repos.md).

The field has converged on five distinct levers. Eco-MCP's thesis is that **no single tool
does all five** — the gateway's value is composing them into one pipeline.

---

## Lever 1 — Structural retrieval (replace grep/cat with an AST/graph)

Code is a tree + graph, not text. Query the structure instead of reading files.

| Tool | What it is | Claimed saving |
|------|-----------|----------------|
| **gortex** (`zzet/gortex`, Go, Apache-2.0) | In-memory code graph, **257 languages**, multi-repo, exposed via CLI/MCP/API. 100+ MCP tools (symbol lookup, call chains, blast radius, dataflow, clone detection). | up to **50×** fewer tokens; `smart_context` replaces 5–10 file reads (~94%). |
| **codebase-memory-mcp** (`DeusData`, C, single static binary) | Indexes repo into a persistent **SQLite knowledge graph** (nodes/edges, Louvain, Cypher query engine). **159 languages**, sub-ms queries, hybrid LSP type resolution. Has an associated paper, arXiv:2603.27277. | ~**120× fewer tokens** / "99% fewer." |
| **cocoindex-code** (`cocoindex-io`, Rust engine + Python) | Lightweight embedded AST-based semantic search CLI; Tree-sitter chunking, incremental embeddings; CLI or MCP; no DB setup. | ~**70% fewer tokens** per turn, fewer retries. |

---

## Lever 2 — Semantic retrieval (CPU-bound embeddings, no GPU/API)

| Tool | What it is | Claimed saving |
|------|-----------|----------------|
| **semble** (`MinishLab`, Python/PyPI) | CPU-only hybrid search: **Model2Vec static embeddings** (`potion-code-16M`) + **BM25** + Reciprocal Rank Fusion, Tree-sitter chunking. Index full repo ~250ms, query ~1.5ms, NDCG@10 0.854 (~99% of a much larger model). MCP server for Claude Code/Cursor/Codex/OpenCode. | ~**98% fewer tokens** than grep+read. |

> **Note for our design:** structural (Lever 1) and semantic (Lever 2) are complementary.
> Original spec proposes `semble` for NL queries + `codebase-memory-mcp` for structural
> traversal, with fallback logic so we don't fire both. gortex notably bundles *both* angles
> ("the grep replacement is three tools, not one" — author's own framing).

---

## Lever 3 — I/O compression (strip noise before it hits context)

| Tool | What it is | Claimed saving |
|------|-----------|----------------|
| **rtk** (`rtk-ai/rtk`, "Rust Token Killer", single Rust binary) | CLI proxy that filters/compresses command output (git, grep, diff, logs, file trees, gh CLI) before it reaches context. 100+ commands, <10ms overhead, no async runtime. | **60–90%** on common dev commands. |
| **caveman** (`JuliusBrussee/caveman`, Claude Code skill) | SKILL.md prompts that force terse, fragment-style **output** ("why use many token when few token do trick"). Levels: lite/full/ultra; bonus caveman-commit, caveman-review. **Output only** — doesn't shrink reasoning. | avg **65% output** reduction (22–87%). |

---

## Lever 4 — Routing, quota & fallback (the gateway proper)

| Tool | What it is | Notes |
|------|-----------|-------|
| **9router** (`decolua/9router`, MIT, ~16.9k★) | Local proxy between coding tools and **40–60+ providers**, 3-tier smart fallback (subscription → cheap pay-per-token → free), real-time **quota tracking + cost dashboard**, format translation (OpenAI/Claude/Gemini/Cursor/Vertex). **Bundles an "RTK Token Saver"** (lossless compress of diffs/grep/trees, −20–40%). | Closest existing thing to our gateway's routing layer. NB: several free tiers (iFlow, Qwen, Gemini CLI) were discontinued in 2026. |

---

## Lever 5 — MCP tool-schema bloat (the overhead nobody sees)

Loading tool definitions costs tokens *before the model does anything*. 31 tools ≈ 3k–5k
tokens; a large server ≈ 10k–17k+ tokens per request.

| Approach / Tool | What it does | Claimed saving |
|------|-----------|----------------|
| **Anthropic "Code Execution with MCP"** (pattern) | Expose MCP servers as code APIs; model imports only what it needs; progressive disclosure; intermediate results stay out of context. | **~98%** (150k→2k in case study). See [papers.md](papers.md). |
| **mcp-compressor** (`atlassian-labs`) | Proxy wrapping any MCP server to shrink tool-description overhead. | **70–97%** description overhead. |
| **Dynamic tool loading** (general technique) | Keyword/semantic scoring of tool names vs. query; inject only top matches; load full schema only when the tool is actually chosen. | toward near-zero baseline. |
| Schema compression | Drop optional-param descriptions, merge servers, return only needed output fields. | **30–60%** per-request. |

---

## How Eco-MCP composes these

The gateway is the integration layer none of the individual tools provide:

```
Agent ──▶ Eco-MCP Gateway ──▶ LLM API (cheap model first)
            │
            ├─ Lever 4: burn-rate gate + routing/fallback   (learn from 9router)
            ├─ Lever 5: dynamic tool loading / code-exec MCP (Anthropic pattern, mcp-compressor)
            ├─ Lever 1+2: intercept grep/cat → AST graph + semantic search
            │             (codebase-memory-mcp / gortex + semble / cocoindex)
            ├─ Lever 3: compress CLI output + diffs + ACs    (rtk + caveman logic)
            └─ CCI: accumulate .context/*.md living docs      (our differentiator)
```

## Sources

- rtk — <https://github.com/rtk-ai/rtk>
- semble — <https://github.com/MinishLab/semble> · <https://news.ycombinator.com/item?id=48169874>
- codebase-memory-mcp — <https://github.com/DeusData/codebase-memory-mcp> · paper <https://arxiv.org/abs/2603.27277>
- gortex — <https://github.com/zzet/gortex> · <https://gortex.dev/>
- cocoindex-code — <https://github.com/cocoindex-io/cocoindex-code> · <https://cocoindex.io/cocoindex-code/>
- 9router — <https://github.com/decolua/9router> · <https://9router.com/>
- caveman — <https://github.com/JuliusBrussee/caveman>
- Anthropic code execution with MCP — <https://www.anthropic.com/engineering/code-execution-with-mcp>
- mcp-compressor — <https://github.com/atlassian-labs/mcp-compressor>
- MCP token-bloat strategies — <https://thenewstack.io/how-to-reduce-mcp-token-bloat/>
