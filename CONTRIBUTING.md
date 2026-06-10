# Collaborator Guide — Eco-MCP Gateway

Welcome! This is our **competition submission**: a token-thrifty **MCP server** for AI
coding agents (Cursor / Claude Code / Copilot) that cuts the cost of agentic coding so cheap models
can do real work. This guide gets you set up and shows where to jump in.

> Start with [`README.md`](README.md) (what it is) and [`docs/README.md`](docs/README.md) (the full
> index: vision, research, benchmark, infra, demo plan).

---

## 1. Local setup (~10 min)

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.3, [uv](https://docs.astral.sh/uv/), `git`, and the
`gh` CLI (for PRs). Linux/macOS.

```bash
# clone WITH submodules (vendor/ are git submodules)
git clone --recurse-submodules https://github.com/tyler-void/eco-mcp
cd eco-mcp
# (already cloned without --recurse-submodules? run: git submodule update --init)

# install deps
bun install
cd bench && bun install && cd ..

# get the retrieval backends
#  - codebase-memory (structural graph) — grab just the binary, do NOT run its installer
#    (it would reconfigure your editors). Put it on PATH or in bench/.tools/.
mkdir -p ~/.local/bin
curl -fsSL https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-linux-amd64-portable.tar.gz | tar -xz -C ~/.local/bin
#  - semble (semantic search) — optional but recommended
uv tool install semble
```

**Verify it works (no API key needed):**
```bash
bun run test:client                 # spawns the MCP server, lists + calls every tool
cd bench
bun run smoke                       # offline harness sanity (should say ALL SMOKE CHECKS PASSED)
bun run src/microbench.ts           # the deterministic retrieval/compression lever numbers
```

---

## 2. Use eco-mcp in your own editor (dogfood it)

The most convincing thing for the pitch is *using* it. Add it to your MCP config (Cursor
`~/.cursor/mcp.json`, Claude Code `.mcp.json`, or VS Code `~/.config/Code/User/mcp.json`) — see the
**"Wire it into your agent"** section in [`README.md`](README.md) for the exact block. Then call
`search_structure` / `get_context` while you work and watch the token savings.

---

## 3. Repo layout

| Path | What |
|------|------|
| `src/` | the MCP server (the product) |
| `bench/` | accuracy-audited benchmark harness + measured results |
| `docs/` | vision, research, infra, demo plan — **[start here](docs/README.md)** |
| `vendor/` | upstream tools we build on (git submodules, MIT/Apache-2.0) |

> **Branch note:** `main` has the v0 core (tools: `search_structure`, `find_concept`, `retrieve`,
> `run_command`). **PR #1** (`feat/eco-mcp-gateway-v0`) adds the **CCI Context Pack** tools
> (`repo_map`, `get_context`, `update_context`) + the GitHub Models benchmark provider. Merge PR #1
> (or `git checkout feat/eco-mcp-gateway-v0`) to get the full 7-tool set.

---

## 4. Where you can help

Pick a workstream (roadmap in [`docs/vision/demo-plan.md`](docs/vision/demo-plan.md)):

- **Burn-rate meter + cost dashboard** — the visible "$X → $Y" ROI view for the pitch (Pillar 0/1).
- **Model routing layer** — cheap-first, escalate on repeated failure (Pillar 4).
- **ast-grep tool** — AST search *and rewrite*, a real grep-replacement the agent can edit with.
- **Live benchmark runs** — measure caching + premium-vs-cheap routing (needs an Anthropic key or a
  GitHub Models PAT; see `bench/README.md`).
- **Demo materials** — slides + a recorded baseline-vs-eco-mcp side-by-side.
- **CCI polish** — Context Pack UX, an aider-style PageRank repo-map.

---

## 5. How we work (please follow these)

- **Branches:** cut `feat/<thing>` off `main`; open a focused PR into `main`. Keep PRs small.
- **Commits:** conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). If AI-assisted, keep the
  `Co-Authored-By:` trailer.
- **Measure, don't assume — our core principle.** An adversarial audit found that the popular claim
  "semantic search saves ~98% tokens" is **false** here (naive top-k loses to scoped grep; the win
  is *structural* retrieval, ~97%). **Never put an unverified number in the pitch.** Label every
  claim **measured / derived / cited** (see [`docs/research/benchmark-results.md`](docs/research/benchmark-results.md)).
- **Secrets — never commit keys.** `.env` (repo root) holds `GEMINI_API_KEY` / `GITHUB_MODELS_TOKEN`
  and is **gitignored**. The harness auto-loads it. Don't paste keys into code, docs, or commits.
- **Don't commit (already gitignored):** `node_modules/`, `bench/.tools/` (binaries),
  `bench/fixtures/oss/` (cloned repos), `bench/results/`, and the local-only brainstorm notes.

---

## 6. Command cheat sheet

| Command | What |
|---------|------|
| `bun run test:client` | end-to-end: spawn server, exercise all tools |
| `cd bench && bun run smoke` | offline harness sanity (no key) |
| `cd bench && bun run src/microbench.ts` | deterministic lever numbers (no key) |
| `cd bench && bun run bench` | full ablation (needs an LLM key in `.env`) |
| `cd bench && bun run report` | reprint the latest ROI report |

---

## 7. Numbers safe to cite in the pitch (honest, measured)

- **Structural retrieval (codebase-memory): ~97% fewer tokens** vs reading whole files.
- **Test-output compression: ~51%.**
- **A cheap model (Gemini Flash) completed 3/3 real coding tasks** (incl. a multi-turn bug fix), sub-cent each.
- ⚠️ **Don't** claim semantic-search 98% (disproven), and don't show cross-provider caching deltas
  (billing artifact). Routing + caching dollar savings are *derived* until measured with a paid key.

---

## 8. Questions?

Ping Tyler. Then read [`docs/vision/vision.md`](docs/vision/vision.md) (the north star) and
[`docs/vision/demo-plan.md`](docs/vision/demo-plan.md) (what we show the judges).
