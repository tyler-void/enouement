> Historical — describes the pre-2026-09-21 gateway scope.

# Demo & Proof Plan (competition)

_Last updated: 2026-06-09._

## What we're actually building (for the "is it just a wrapper?" question)

~40% is **wrapping** proven tools (rtk, semble, codebase-memory-mcp, 9router) — deliberately;
reinventing them is how the project dies in scope. ~60% is the **product** nobody else has and
the part we defend:

1. **Cache-aware canonicalizer** (Pillar 0) — the biggest lever; no vendored tool does it.
2. **Router policy** — phase/complexity-aware model selection + escalation (9router = plumbing).
3. **Small-model scaffolding loop** — execution-repair + escalation (an algorithm, not glue).
4. **CCI / Context Packs** — original workflow, the differentiator.
5. **Measurement layer** — unified token/cost accounting = the benchmark harness + ROI dashboard.

One-liner for skeptics: *"an orchestration brain that composes proven token-savers into one
pipeline, adds the caching + small-model layers none of them have, and proves the savings with
hard numbers."* The competition rewards measured value + adoption, not component novelty.

## The proof: ablation benchmark (`bench/`)

Built and runnable (`bench/README.md`). An **ablation ladder** (A0 baseline → A5 full gateway)
over a fixed task suite, run K times, reporting **medians** (per-run variance up to 30×, per
Bai et al.) and — crucially — **cost per *successful* task**, so a cheap-but-failing profile
can't look like a win.

- Status: harness + self-contained fixture + offline smoke (12/12 pass) ✅. Needs an LLM
  endpoint (Anthropic key, or 9router/LiteLLM via `LLM_BASE_URL`) to produce live numbers.
- Output: `results/report-*.md` — per-profile table + savings waterfall.

## The pitch: 3 acts

1. **The shock** — your real number ($60 in 9 days), the **June 1 Copilot usage-based billing**
   change (25× bills), and the Bai paper: input tokens dominate, accuracy doesn't scale with
   spend, agents can't predict their own cost. Pain is real, billed, and industry-wide.
2. **The proof** — same task, side by side: baseline (raw tools + premium) vs Eco-MCP (cheap
   model + gateway), live token/$ counter. Both ship working code; gateway uses a fraction of the
   tokens on a model that costs ~10× less. Then the **savings waterfall** from the ablation:
   "caching −X%, retrieval −Y%, cheap-model −Z% → ~70% total, **success rate unchanged**."
3. **The compounding value** — CCI/onboarding: a newcomer task solved by reading a 1k-token
   Context Pack instead of a 30k-token module dump. Lands "implicit → explicit knowledge at
   near-zero token cost."

## Decisions locked (2026-06-09)
- Benchmark target: **public OSS repo** (safe/shareable); a private mirror run as confirmation.
- Agent substrate: **custom minimal agent loop** for rigorous numbers; record a real-tool
  (Cursor/Copilot) side-by-side separately for Act 2 theater.

## Progress (2026-06-09)
- ✅ **(b) Real backends wired** — semble (semantic) + codebase-memory-mcp (structural graph)
  behind the `retrieve` / `query_structure` tools, with keyword fallback. Both confirmed to solve
  tasks on the sample app and on hono. Auto-detected; binary in `bench/.tools/` (gitignored).
- ✅ **(c) Public-OSS suite** — `BENCH_SUITE=hono` (186-file real repo), 5 read-only navigation
  tasks graded by file path. Suite registry supports `sample-app` | `hono`.
- ✅ **Gemini provider** — auto-detected from repo-root `.env` (`GEMINI_API_KEY`); `.env` gitignored.
- Smoke (offline) and all entrypoints build clean.

## First results (2026-06-09, post-audit corrected) — see [../research/benchmark-results.md](../research/benchmark-results.md)
An adversarial 5-lens audit forced corrections; the **honest** numbers:
- **Structural graph (codebase-memory): 97% fewer tokens** vs reading whole files — the robust win.
- **Naive semantic top-k (semble): only 22%, and ~4× WORSE than scoped grep** — a non-obvious,
  credibility-building finding: "semantic search saves 98%" is not generally true. Retrieval value
  is a *routing* decision (grep→structural→tuned-semantic), not "bolt on embeddings."
- **Test-output compression 51%.**
- **3/3 sample-app tasks PASS on Gemini Flash** (incl. an 8-turn bug fix), <$0.0033 each.
- Premium tier 429s on the free key → routing lever (4–15× cheaper) is derived from list price.
- The first-pass "95% retrieval" was an artifact (rigged locator-vs-document + repo-wide grep) —
  caught and fixed. The pitch differentiator is "we measured it instead of assuming it."

## PRODUCT v0 shipped (2026-06-09) — the thing to show
A working **MCP server** (`src/server.ts`, installable in Cursor/Claude Code) — not slides:
- `search_structure` (codebase-memory graph, the 97% winner), `find_concept`, `retrieve` (tuned
  semble), `run_command` (failures-only compression). Verified via `bun run test:client`.
- Install/config in top-level `README.md`. Retrieval-first per scope decision.
- Not yet: cache-aware egress + burn-rate meter, model routing, CCI/Context Packs.

## Next
1. Demo: install eco-mcp in Cursor on a real repo, show search_structure replacing grep+read live.
2. Build CCI/Context Packs (aider-style PageRank repo-map) — the differentiator pillar.
3. Add ast-grep (AST search+rewrite) as a tool; cache-aware egress + burn-rate meter.
4. For a clean cost waterfall, use an Anthropic key (measures caching + routing live) — Gemini
   free 429s on pro and on daily quota.
2. Wire **rtk** as the real output-compression backend (currently a regex stand-in for test logs).
3. Add SWE-bench-style fix tasks on the OSS repo (revert a real fix commit → agent makes tests green).
4. Verify pricing in `bench/config/pricing.ts` against live rates before quoting.
