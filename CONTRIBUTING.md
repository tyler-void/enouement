# Collaborator Guide — Eco-MCP

Welcome! This is our **competition submission**: an **MCP server** that gives AI coding
agents (Cursor / Claude Code / Copilot) project memory — per-module Context Packs the agent reads
before it works and writes back when it's done. This guide gets you set up and shows where to
jump in.

> **Scope narrowed 2026-09-21.** The retrieval tools (`search_structure`, `retrieve`, `repo_map`)
> are gone: the tools we wrapped now ship their own MCP servers. Retrieval lives on in `bench/`
> as measurement. See the Scope section of [`README.md`](README.md).

> Start with [`README.md`](README.md) (what it is) and [`docs/README.md`](docs/README.md) (the full
> index: vision, research, benchmark, infra, demo plan).

---

## 1. Local setup (~10 min)

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3, [uv](https://docs.astral.sh/uv/), `git`, and the
`gh` CLI (for PRs). Linux/macOS.

```bash
git clone https://github.com/tyler-void/enouement
cd eco-mcp

# install deps
bun install
cd bench && bun install && cd ..

# the server itself needs nothing else. For the bench/ retrieval experiments only:
uv tool install semble
```

**Verify it works (no API key needed):**
```bash
bun run test:client                 # spawns the MCP server, lists + calls both tools
cd bench
bun run smoke                       # offline harness sanity (should say ALL SMOKE CHECKS PASSED)
bun run src/microbench.ts           # the deterministic retrieval/compression lever numbers
```

---

## 2. Use eco-mcp in your own editor (dogfood it)

The most convincing thing for the pitch is *using* it. Add it to your MCP config (Cursor
`~/.cursor/mcp.json`, Claude Code `.mcp.json`, or VS Code `~/.config/Code/User/mcp.json`) — see the
**"Wire it into your agent"** section in [`README.md`](README.md) for the exact block. Then call
`get_context` before you start on a module and `update_context` when you finish — the second one
is the habit that matters, and the one we're trying to make automatic.

---

## 3. Repo layout

| Path | What |
|------|------|
| `src/` | the MCP server (the product) |
| `bench/` | accuracy-audited benchmark harness + measured results |
| `docs/` | vision, research, infra, demo plan — **[start here](docs/README.md)** |

> **Tool surface:** `main` ships exactly two tools — `get_context` and `update_context`.
> `test/client.ts` asserts that list exactly, so a tool cannot reappear unnoticed.

---

## 4. Where you can help

Pick a workstream (roadmap in [`docs/vision/demo-plan.md`](docs/vision/demo-plan.md)):

**Product (CCI write side):**
- **Make the write automatic** — a Stop hook + a skill, so the agent doesn't have to remember to
  call `update_context`. The single highest-value item.
- **Write nested `AGENTS.md`** instead of `.context/domain_logic.md`, so agents that already read
  nested memory files pick the knowledge up with no MCP call at all.
- **Cap and summarize Context Packs** so the living docs don't bloat over sprints (the one open
  question in [`docs/vision/vision.md`](docs/vision/vision.md) that survived the scope change).

**Research (`bench/`):**
- **Live benchmark runs** — measure caching + premium-vs-cheap routing (needs an Anthropic key or a
  GitHub Models PAT; see `bench/README.md`).
- **Re-measure retrieval like-for-like** — the ~97% / 78% figures are under revision; see Known
  issues in [`README.md`](README.md).
- **Jev rerank** — run the adaptive-k experiment against the live API; it has no result yet.

---

## 5. How we work (please follow these)

> The project's principles are ratified in [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
> This section summarises them for day-to-day work; where the two differ, the constitution governs.

- **Branches:** cut `feat/<thing>` off `main`; open a focused PR into `main`. Keep PRs small.
- **Commits:** conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). If AI-assisted, keep the
  `Co-Authored-By:` trailer.
- **Measure, don't assume — our core principle.** An adversarial audit found that the popular claim
  "semantic search saves ~98% tokens" is **false** here (naive top-k loses to scoped grep). The
  structural ~97% that replaced it is **itself under revision** — the two baselines were asked
  different questions. **Never put an unverified number in the pitch.** Label every
  claim **measured / derived / cited** (see [`docs/research/benchmark-results.md`](docs/research/benchmark-results.md)).
- **Secrets — never commit keys.** `.env` (repo root) holds `GEMINI_API_KEY` / `GITHUB_MODELS_TOKEN`
  and is **gitignored**. The harness auto-loads it. Don't paste keys into code, docs, or commits.
- **Don't commit (already gitignored):** `node_modules/`, `bench/.tools/` (binaries),
  `bench/fixtures/oss/` (cloned repos), `bench/results/`, and the local-only brainstorm notes.

---

## 6. Command cheat sheet

| Command | What |
|---------|------|
| `bun run test:client` | end-to-end: spawn server, assert the tool list, CCI round-trip |
| `cd bench && bun run smoke` | offline harness sanity (no key) |
| `cd bench && bun run src/microbench.ts` | deterministic lever numbers (no key) |
| `cd bench && bun run bench` | full ablation (needs an LLM key in `.env`) |
| `cd bench && bun run report` | reprint the latest ROI report |

---

## 7. Numbers safe to cite in the pitch (honest, measured)

- **A cheap model (Gemini Flash) completed 3/3 real coding tasks** (incl. a multi-turn bug fix), sub-cent each.
- **Test-output compression: ~51%** — measured, though the tool that used it is gone.
- ⚠️ **Don't** claim semantic-search 98% (disproven). ⚠️ **Don't** cite structural ~97% / 78%
  either until the like-for-like re-measurement lands (Known issues in [`README.md`](README.md)).
  Don't show cross-provider caching deltas (billing artifact); routing + caching dollar savings
  are *derived* until measured with a paid key.

---

## 8. Questions?

Ping Tyler (@tyler-void). Then read [`docs/vision/vision.md`](docs/vision/vision.md) (the north star) and
[`docs/vision/demo-plan.md`](docs/vision/demo-plan.md) (what we show the judges).
