# Eco-MCP Benchmark Harness

Measures how much each Eco-MCP gateway **lever** cuts token cost, vs a raw baseline, on a
fixed set of coding tasks — producing the **ROI waterfall** for the competition pitch.

It is an **ablation ladder**: same tasks, same agent loop, turning on one lever at a time, so
savings can be attributed to *each* lever (caching, retrieval, output compression, cheap-model
routing) rather than to "the gateway" as a black box.

## Why this design
- **Custom minimal agent loop** (`src/agent/loop.ts`) — full control, deterministic setup,
  clean token accounting, unattended K-repeat runs.
- **Self-contained fixture** (`fixtures/sample-app/`) — a tiny payment/checkout TS app with a
  real test suite and planted tasks. No external clone, no IP exposure, reproducible. Swap in a
  public OSS repo later (see below).
- **Honest metric** — we report **cost per *successful* task**, not just tokens. A cheap profile
  that fails more is not a win.
- Per-run token usage varies a lot (Bai et al. 2604.22750: up to **30×**), so every cell is run
  K times and we report **medians**, never a single number.

## The ablation ladder (`src/profiles.ts`)
| Profile | Lever added |
|---|---|
| A0 | Baseline: raw grep/read + premium model, no caching ("today") |
| A1 | + prompt caching |
| A2 | + compact retrieval (replace grep/read) |
| A3 | + output compression (rtk-style test-log trimming) |
| A4 | + cheap model + terse output (full gateway) |
| A5 | + escalation ladder (reserved — currently == A4) |

## Tasks (`src/tasks/suite.ts`)
- **navigate** — "which file/function applies tax?" (isolates the retrieval lever; graded by answer)
- **fix-rounding** — fix a truncation bug so `test/money.test.ts` passes (graded by tests)
- **feature-discount** — create `src/discount.ts` so `test/discount.test.ts` passes (graded by tests)

## Run it

```bash
cd bench
bun install

# 1) offline sanity check — NO API key needed
bun run smoke

# 2) the real benchmark — needs an LLM endpoint (see below)
bun run bench

# 3) re-print the latest report
bun run report
```

### LLM endpoint
Auto-detected (priority order). Pick ONE:
- **Gemini** (your free key) — auto-detected from the repo-root `.env` `GEMINI_API_KEY`. Uses
  Gemini's OpenAI-compatible endpoint. Zero config: just `bun run bench`.
- **Anthropic native** (best for accurate caching measurement): `export ANTHROPIC_API_KEY=sk-...`
- **Any OpenAI-compatible endpoint** — OpenAI, **9router**, LiteLLM:
  `export LLM_BASE_URL=http://localhost:20128/v1` + `export LLM_API_KEY=...` (or `OPENAI_API_KEY`).

Force one with `LLM_PROVIDER=gemini|anthropic|openai-compat`.

> **Gemini free-tier rate limits** are low. Start small: `BENCH_RUNS=1 BENCH_PROFILES=A0,A4 bun run bench`.

### Suites — `BENCH_SUITE`
- `sample-app` (default) — the built-in fixture; fix/feature tasks graded by tests.
- `hono` — real OSS repo (186 src files), read-only navigation tasks graded by file path.
  Clone first: `git clone --depth 1 https://github.com/honojs/hono fixtures/oss/hono`
  Run: `BENCH_SUITE=hono bun run bench`

### Real retrieval backends (wired)
The `retrieve` / `query_structure` tools use the **real production binaries** when present, else a
keyword fallback. Detection is automatic:
- **semble** (semantic) — `semble` on PATH or `~/.local/bin/semble`. Install: `uv tool install semble`.
- **codebase-memory-mcp** (structural graph) — binary at `bench/.tools/codebase-memory-mcp` or on
  PATH (`CBM_BIN` to override). The benchmark uses its `cli` mode (no MCP client, no agent-config
  side effects). Grab just the binary:
  `curl -fsSL <release>/codebase-memory-mcp-linux-amd64-portable.tar.gz | tar -xz -C bench/.tools`
The run header prints which backends are active (`semantic=semble structural=codebase-memory`).

### Knobs
- `BENCH_RUNS=5` — repeats per (profile × task) (default 3)
- `BENCH_PROFILES=A0,A4` — run only some profiles (quick A0-vs-full comparison)

Outputs land in `results/`: `results-<ts>.json` (raw) and `report-<ts>.md` (the ROI report).

## Status / honest limitations
- Real backends (semble + codebase-memory) are wired; keyword fallback only if binaries absent.
- Caching: accurate on Anthropic (`cache_creation`/`cache_read`). On Gemini/OpenAI it reads
  `prompt_tokens_details.cached_tokens`. **Gemini DOES report cached tokens for multi-turn tasks**
  (implicit caching engages once the prefix repeats — e.g. an 8-turn fix reused 5,453 cached
  tokens); a single isolated call shows 0 (nothing to cache yet). Premium tier (`gemini-2.5-pro`)
  is 429 on the free key, so live premium-vs-cheap routing needs an Anthropic/paid key.
- Pricing in `config/pricing.ts` is approximate — **verify before quoting** (esp. Copilot AI-Credit
  multipliers).
- A5 escalation is not yet wired (== A4 for now).
- The `hono` suite is read-only and run in place (not copied per run) so indexes are reused; the
  agent is not asked to write.
