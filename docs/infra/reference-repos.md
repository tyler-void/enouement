> Historical — describes the pre-2026-09-21 gateway scope.

# Infrastructure — Reference Repos (clone / vendor / integrate)

_Last updated: 2026-06-09._

> **`vendor/` was removed on 2026-09-21** — all 7 submodules (1.3 GB checked out) are gone
> along with the gateway scope that wrapped them. Nothing in the repo referenced them at
> runtime. **The table below is now the record of what they were**; re-clone any of them from
> its URL if you need to read the source.

All 7 hot-hit repos were **cloned as shallow git submodules** under `vendor/` (done
2026-06-09, removed 2026-09-21). **Before vendoring any code, confirm its license and keep upstream notices** —
see the IP strategy in [../vision/vision.md](../vision/vision.md). The competition submission
must stay scoped to the **gateway layer we build on top**, not the vendored tools themselves.
All 7 licenses verified permissive (MIT / Apache-2.0) — clean.

> Status legend: ☐ not cloned · ◐ cloned, studying · ☑ integrated/wrapped.
> All currently ◐ (cloned + researched; not yet wrapped).

## Layout (live)

```
vendor/            # shallow git submodules, untouched upstream
  ├── rtk/                  (Apache-2.0,  4.8M)
  ├── semble/               (MIT,         3.2M)
  ├── codebase-memory-mcp/  (MIT,         1.3G ⚠️ — internal/ is 1.2G of fixtures/grammars)
  ├── gortex/               (Apache-2.0,   27M)
  ├── cocoindex-code/       (Apache-2.0,  1.3M)
  ├── 9router/              (MIT,          11M)
  ├── caveman/              (MIT,         1.3M)
  └── LICENSES/             # mirror each repo's license here as we adapt code
src/               # our gateway code (the part we submit)
```

We used **git submodule** (clean license boundary, easy upstream sync, submodule pointer is
just a SHA so it doesn't bloat our object store). Re-clone with `git submodule update --init`.

> ⚠️ **Disk flag:** `codebase-memory-mcp` is **1.3 GB** on disk even shallow (1.2 GB in
> `internal/` — test fixtures + vendored tree-sitter grammars). Fine for the submodule's own
> git, but heavy on disk. If this matters, use a sparse-checkout to pull only `src/` + docs, or
> rely on the prebuilt binary via its install script instead of the source tree.

## The repos

| Repo | Role (lever) | Lang / form | License | Pin | Recommended use |
|------|-------------|-------------|---------|-----|-----------------|
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | I/O compression (L3) | Rust binary | **Apache-2.0** | dev-0.43.0-rc.271 | **PRIMARY layer A.** Wrap binary; `run_command` shells through `rtk`. −80% session. |
| [MinishLab/semble](https://github.com/MinishLab/semble) | Semantic search (L2) | Python / PyPI, MCP | **MIT** | v0.3.3 | **PRIMARY layer C.** MCP-stdio or CLI; CPU-only, no keys. NDCG@10 0.854. |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Structural graph (L1) | C static binary, MCP | **MIT** | main | **PRIMARY layer B.** On-disk SQLite graph, cold-queryable, 159 langs, 14 tools. |
| [zzet/gortex](https://github.com/zzet/gortex) | Structural graph (L1, broad) | Go (1.26+, CGO) | **Apache-2.0** | main | **ESCALATION layer B.** Add for dataflow / blast-radius / 257 langs. Daemon + ~5GB RAM — too heavy as default. |
| [cocoindex-io/cocoindex-code](https://github.com/cocoindex-io/cocoindex-code) | Semantic/AST search (L1/L2) | Rust engine + Python | **Apache-2.0** | v0.2.35 | ALT layer C only. Needs cloud key or 1GB local model + warm daemon; no published benchmarks. |
| [decolua/9router](https://github.com/decolua/9router) | Routing/quota/fallback (L4) | Node proxy | **MIT** | v0.4.71 | **BUILD ON IT.** Gateway sits in front; 9router owns provider routing/fallback/quota. Bundles rtk. |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | Output compression (L3) | Claude Code skill | **MIT** | main | Inject terse-output preamble; ~−65% output. Low priority, near-zero cost. |

Adjacent (technique, not necessarily vendored):
- [atlassian-labs/mcp-compressor](https://github.com/atlassian-labs/mcp-compressor) — MCP
  schema-overhead proxy (L5), 70–97% description reduction. Worth studying for the dynamic
  tool-loading layer.

## Resolved decisions

1. **Submodules** — cloned shallow under `vendor/` 2026-06-09, removed 2026-09-21 (unused).
2. **Overlap resolved** — primaries picked: rtk (A), codebase-memory-mcp (B), semble (C),
   9router (routing). gortex = opt-in escalation; cocoindex = alt. Full rationale + wrapper
   contract in [recommended-stack.md](recommended-stack.md).
3. **Wrapping** — TS/Bun gateway drives binaries via MCP-stdio (retrieval backends) or plain
   subprocess (rtk). `BackendAdapter` contract in [recommended-stack.md](recommended-stack.md).

## Next actions

1. Validate the picks with a real benchmark on a private mirror run: old-flow vs gateway-flow
   token + cost delta on one task (methodology, not a single number — 30× per-run variance).
2. Stand up the cache-aware egress layer first (SPARK 0 — biggest immediate win) — see
   [../research/new-sparks-2026.md](../research/new-sparks-2026.md).
3. Mirror each repo's license into `vendor/LICENSES/` if/when we adapt code from it.
