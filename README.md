# enouement

**Repo-native, PR-reviewed project knowledge for spec-driven, agent-assisted development.** The
reasoning behind a change lives in the repository next to the code it explains, arrives through
ordinary code review, and is still there — and still findable — a year later.

## Status: pre-alpha. Nothing is installable yet.

Read this before trying to use it:

- **Spec 001 (continuous project knowledge) is in progress**, on the
  [`001-continuous-project-knowledge`](https://github.com/tyler-void/enouement/tree/001-continuous-project-knowledge)
  branch. Specification, plan, contracts and research are written; **no implementation has
  started**.
- **What is on `main` today** is the earlier work: a small MCP server with two tools
  (`get_context`, `update_context`) and the benchmark harness in `bench/`. It runs, and it is not
  what the name above describes yet.
- **Code identifiers still say `eco-mcp`** — the package name, the binary, the `ECO_*`
  environment variables, the log prefix. The name is settled; the in-repo rename is deliberately
  deferred and tracked in
  [#1 — Spec 002: in-repo rename + distribution](https://github.com/tyler-void/enouement/issues/1),
  so that one change is reviewed on its own rather than smeared across a feature branch.
- Nothing is published to npm. The names `enouement` and `enou` were unclaimed on 2026-09-21 and
  have **not** been reserved with a placeholder package.

## About the name

*Enouement* is one of John Koenig's coinages from
[The Dictionary of Obscure Sorrows](https://www.thedictionaryofobscuresorrows.com/word/enouement).
It names a particular ache: you finally reach the future and find out how things turned out — and
there is no way to carry that back to the version of you who needed it, who is still standing in
the past, still guessing.

This tool is an attempt to run the feeling backwards. It cannot send anything to your past self.
What it can do is make your past self leave the notes — recorded while the reasons were still
fresh, committed beside the code, waiting for whoever arrives next. Usually that is you.

## What is on `main` today

The MCP server described below is the earlier work, not the tool the name promises. It
works; it is narrower than what spec 001 specifies.

| Tool | What it does | Why it's cheap |
|------|-------------|----------------|
| `get_context` | read the module's **Context Pack** (`.context/*.md` living docs), module-specific first, broader context after | digested domain knowledge, not source |
| `update_context` | persist what you learned to `<module>/.context/domain_logic.md` | next agent reads ~1k tokens, not the module |

### Continuous Context Integration (CCI)
After finishing a task, the agent writes the distilled domain logic (business rules, decisions,
gotchas) into `<module>/.context/domain_logic.md`, staged into the PR so **code review = context
review**. Next sprint, an agent reads that ~1k-token Context Pack instead of the whole module.
The synthesis is done by the agent's own model — no extra API key, no network calls, nothing
leaves the machine.

## Requirements
- [Bun](https://bun.sh) ≥ 1.3

That's all. The server reads and writes Markdown in your repo; it shells out to nothing. (The
benchmark harness in `bench/` optionally wants **semble** — `uv tool install semble` — for the
retrieval experiments. The server never calls it.)

## Install
```bash
git clone https://github.com/tyler-void/enouement
cd enouement && bun install
bun run test:client          # smoke test: spawns the server, lists + calls both tools
```

## Wire it into your agent

**Claude Code** — `.mcp.json` in your project (or `claude mcp add`):
```json
{
  "mcpServers": {
    "eco-mcp": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/eco-mcp/src/server.ts"],
      "env": { "ECO_WORKSPACE": "/ABSOLUTE/PATH/to/your/project" }
    }
  }
}
```

**Cursor** — same block in `~/.cursor/mcp.json` or `.cursor/mcp.json`.

`ECO_WORKSPACE` is the repo whose Context Packs are read and written (defaults to the server's
cwd).

## Known issues

**The `~97%` / `78%` retrieval figures in the benchmark docs are under revision.** The benchmark's
grep baseline and its structural baseline were asked different questions — a bare keyword versus
an anchored `^name$` regex — so the comparison is not like-for-like. A corrected measurement is
pending; treat both numbers as unreliable until it lands. They no longer back any claim in this
README, since retrieval is not part of the product.

History: `find_concept` and `run_command` were removed on 2026-07-28 for returning confidently
wrong output; `search_structure`, `retrieve` and `repo_map` followed on 2026-09-21 with the
scope change. Details for all of it:
[docs/research/discovery-2026-07-28.md](docs/research/discovery-2026-07-28.md).

## Repo layout
- `src/` — the MCP server that exists today
- `bench/` — the accuracy-audited benchmark harness + retrieval experiments
- `docs/` — vision, research, infra, demo plan ([start here](docs/README.md))

## What comes next

Spec 001 replaces the two tools above with something that records *why*, not just *what*:
immutable knowledge records in the repository, a `why` command that answers from paths, git
trailers and rename history, and enforcement that runs in both a local git hook and CI. The
specification, plan and contracts are on the
[`001-continuous-project-knowledge`](https://github.com/tyler-void/enouement/tree/001-continuous-project-knowledge)
branch; implementation has not started.

Superseded and not being built: the cache-aware egress meter and model routing from the gateway
era.
