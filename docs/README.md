# Eco-MCP — Documentation

This folder is the living knowledge base for **Eco-MCP**: a local MCP server that gives coding
agents project memory — per-module Context Packs, read before the work and written back after,
in the repo and reviewed in the PR.

> **Scope narrowed 2026-09-21.** Most of this folder documents the earlier *gateway* design
> (retrieval + compression + routing). Those docs are kept as a record and banner-marked where
> they describe it. The current scope is in [vision/vision.md](vision/vision.md).

> **Project context:** built as a **competition submission** (Round 1).
> The catalyst is GitHub Copilot's move to usage-based billing on **2026-06-01** (see
> [research/copilot-pricing-shock.md](research/copilot-pricing-shock.md)).

## How to use this folder

Add to it whenever we learn something new — a benchmark, a paper, a new niche tool, an
architecture decision. Keep each doc focused; link between them rather than duplicating.
Date every substantive update.

## Index

### Vision
- [vision/vision.md](vision/vision.md) — ⭐ **start here**: current scope (2026-09-21), then the gateway-era north star, value proposition, competition framing and IP strategy, kept and marked.
- [vision/demo-plan.md](vision/demo-plan.md) — what we're building (the "is it a wrapper?" answer), the 3-act pitch, proof plan.

### Research
- [research/copilot-pricing-shock.md](research/copilot-pricing-shock.md) — the market catalyst (Copilot usage-based billing, June 2026).
- [research/landscape-2026.md](research/landscape-2026.md) — the niche tools/repos/techniques attacking coding-LLM cost in 2026 (the 5 levers).
- [research/new-sparks-2026.md](research/new-sparks-2026.md) — ⭐ **deep dive**: prompt caching (the missed #1 lever), small-model scaffolding ladder, context engineering, newest tools/papers.
- [research/benchmark-results.md](research/benchmark-results.md) — ⭐ **measured results**: compression 54%, 3/3 tasks on a cheap model; honest measured/derived/cited labelling. ⚠️ the retrieval percentages are under revision.
- [research/papers.md](research/papers.md) — academic foundation (the token-economics papers).

### Infrastructure
- [infra/architecture.md](infra/architecture.md) — the gateway design; **6 pillars** (0–5) + data flow.
- [infra/recommended-stack.md](infra/recommended-stack.md) — ⭐ decisive tool picks per layer + the `BackendAdapter` orchestration contract.
- [infra/reference-repos.md](infra/reference-repos.md) — the 7 reference repos, licenses, URLs (vendored as submodules 2026-06-09, removed 2026-09-21).
- [infra/footprint-and-deployment.md](infra/footprint-and-deployment.md) — measured RAM/CPU/disk; local-vs-hosted decision (local-first).

### Reference repos
The 7 upstream tools we studied (all MIT/Apache-2.0) were vendored as shallow git submodules
under `vendor/` until 2026-09-21; nothing referenced them at runtime, so they were removed.
[infra/reference-repos.md](infra/reference-repos.md) keeps the list and the URLs.

### Benchmark harness
`bench/` — ablation benchmark (A0 baseline → A5 full gateway) over a self-contained fixture app,
plus the retrieval experiments that outlived the gateway (`src/experiments/jev-rerank/`).
Offline smoke and unit tests pass with no API key (`bun run test`); `bun run bench` produces the
ROI waterfall once an LLM endpoint is configured. See `bench/README.md` and
[vision/demo-plan.md](vision/demo-plan.md).

## Source material (repo root)
- `SPEC.md` — the polished English technical spec (v0).
- `gemini.md` / `before.md` — original brainstorm in Vietnamese; holds full intent and reasoning.
- `.specify/` — Spec Kit tooling (constitution still unfilled as of 2026-06-09).

_Last updated: 2026-09-21._
