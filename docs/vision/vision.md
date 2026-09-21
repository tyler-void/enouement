# Vision — Eco-MCP

_Last updated: 2026-09-21 (scope narrowed). Gateway-era sections below are kept and marked._

## Current scope (2026-09-21)

**Product: the CCI write side.** An agent finishing a task writes the distilled domain logic
back into the repo — **automatic** (not something it has to remember to call), **in-repo**
next to the code, **per-module**, and **reviewed in the PR** like any other change. That is the
one thing still unsolved: codebase-memory-mcp, semble and rtk each ship their own MCP server,
skills and hooks now, so wrapping them in a gateway adds nothing, and Claude Code already loads
nested `CLAUDE.md`/`AGENTS.md` on demand — which covers the *read* side. Nobody writes back.

**Research: `bench/`.** Independent, cross-tool measurement of what actually saves tokens, kept
deliberately separate from the product and free to report that a lever does not work — it
already has. That includes the Jev relevance-filter experiment (adaptive k over semble chunks),
which lives in `bench/src/experiments/jev-rerank/` and claims no result until it is measured
against a live API.

Everything below predates this and is kept for the record.

## One-liner

> Superseded 2026-09-21 — the proxy/gateway layer was never built and is not planned.

A local proxy + MCP server that sits between an AI coding agent (Cursor / Cline /
Copilot / Claude Code) and the LLM API, and aggressively cuts token spend so cheap models
(Haiku, GPT-mini) can do work that today burns money on premium models.

## Why now

On **2026-06-01** GitHub Copilot moved every plan to **usage-based billing** (AI Credits
priced on real token consumption). Developers report bills jumping up to **25×**, and
agentic sessions costing **$30–40 each**. A Pro user's $10/month credit can be exhausted
in a single session. This turned token efficiency from a nice-to-have into an operational
emergency for every team using agentic coding. See
[../research/copilot-pricing-shock.md](../research/copilot-pricing-shock.md).

This is empirically grounded, not vibes: the foundational paper
(arXiv:2604.22750, Bai et al.) shows agentic coding burns **~1000× more tokens** than
chat, **input tokens** dominate cost, accuracy does **not** scale with spend, and agents
**cannot predict their own token usage**. See [../research/papers.md](../research/papers.md).

## The core insight

> You don't need to feed the model the whole repo, raw logs, and every tool schema.
> Feed it the **smallest clean context** that lets it finish the task — and a cheap model
> will do just fine.

> Superseded 2026-09-21 — levers 1–3 belong to tools that now ship their own MCP servers.
> Lever 4 is the product.

Four levers, each backed by an existing proven tool we learn from:
1. **Estimate & gate cost before dispatch** (burn-rate firewall).
2. **Compress I/O** — strip noisy logs, filler ACs, full-file payloads.
3. **Replace grep/cat with structural + semantic retrieval** (AST graph + embeddings).
4. **Accumulate living context** so future tasks start from digested knowledge, not raw code.

## North-star outcomes

> Superseded 2026-09-21 — the token-reduction targets were the gateway's.
> Onboarding velocity and living documentation carry over as the CCI outcomes.

- **70–90% reduction** in input tokens per task.
- **Cheap models become workhorses** — most tasks complete on Haiku/GPT-mini; escalate to
  premium only on repeated failure.
- **Onboarding velocity** — a newcomer's agent reads a 1k-token Context Pack instead of a
  30k-token module dump.
- **Living documentation** — docs stay synced with code because they're generated per-PR
  and reviewed alongside the diff.

## Continuous Context Integration (CCI) — the differentiator

> **Current.** This section is the product; see Current scope above.

Most teams use AI as disposable labor: code, then throw away the context. The Eco-MCP bet
is **progressive knowledge accumulation** — every User Story / defect fix appends a
distilled `.context/*.md` next to the code, staged into the PR so **code review = context
review**. Over sprints the repo grows "a book," one chapter per module. This converts
implicit knowledge (in seniors' heads) into explicit knowledge (in the repo) at near-zero
token cost, and naturally forces documentation the way code review forces quality.

## Competition positioning

> Superseded 2026-09-21 — the pitch below describes the gateway.

Pitch it as infrastructure, not personal savings:

> **"Eco-Agent: an MCP-standard cost-optimization gateway that cuts daily AI-assistant
> API spend 70–80% across projects."**

- **Problem:** devs burn tokens on noisy logs, whole-codebase reads, and premium models for
  trivial tasks — and Copilot's June pricing made this acutely expensive.
- **Solution:** intercepting proxy that estimates cost, compresses context, retrieves
  structurally, and routes tasks to the cheapest model that can do them.
- **Proof:** benchmark a real task old-flow vs. new-flow; show the token/cost delta and
  an ROI dashboard ("$60 direct → $5 via gateway").

## IP strategy (important)

- **Open-source inputs are safe to learn from.** 9router, caveman, rtk are MIT/permissive;
  IP law protects specific *implementation*, not *ideas/architecture*. Re-implementing the
  logic ourselves is sound. Keep upstream license/copyright notices for any code we vendor.
- **Company-IP trap.** Anything submitted to the competition likely becomes company IP.
  **Deliberate separation:** submit *only* the cost-optimization gateway. Keep any personal
  core projects (e.g. crawler / stock-dashboard work) entirely out of the submission. The
  gateway is the perfect thing to give away — it's infrastructure, fits Round 1's
  "creates value for the org" criterion, and shields personal projects.
- **Plan for this repo:** _(superseded 2026-09-21 — `vendor/` was removed; the list and the
  licenses live on in [../infra/reference-repos.md](../infra/reference-repos.md).)_
  we clone/vendor the current hot-hit repos here to study and
  integrate them. Track each one's license in
  [../infra/reference-repos.md](../infra/reference-repos.md) before vendoring, and keep the
  competition submission scoped to the gateway layer we build on top.

## Open questions to resolve

> Superseded 2026-09-21 — packaging and indexing questions belonged to the gateway.
> The live question is the last one: how to cap/summarize `.context/*.md` so the living docs
> do not themselves bloat over sprints.

- Daemon vs. IDE plugin packaging? (Leaning plugin for team setup ease.)
- Central indexing cronjob vs. per-dev local index for the AST graph?
- How to cap/summarize `.context/*.md` so the living docs don't themselves bloat over sprints?
- Stack for the proxy core: Bun vs. NestJS/TypeScript vs. Rust.
