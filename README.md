# Eco-MCP Gateway

A token-thrifty **MCP server** for AI coding agents (Cursor / Claude Code / Cline / Codex). It
replaces the expensive habits that drive agentic-coding cost — `grep` + reading whole files,
dumping verbose logs — with compact, structured tools, so **cheap models can do real work**.

Born from the GitHub Copilot usage-based-billing shock (June 2026). Measured, not assumed —
see [docs/research/benchmark-results.md](docs/research/benchmark-results.md).

## Known issues

**Two tools were removed on 2026-07-28 because they returned incorrect output.**

- `find_concept` — codebase-memory-mcp 0.7.0 silently ignores the `semantic_query` parameter and
  returns the entire symbol table, so unrelated queries produced byte-identical results.
- `run_command` — the output compressor misclassified any output containing the substring `test`
  (so `latest` matched too) as a test run and discarded the rest; when nothing survived the filter
  it substituted the literal string `all checks passed (no failures)`. `cat package.json` returned
  that string with exit 0.

**The `~97%` / `78%` retrieval figures below and in the benchmark docs are under revision.** The
benchmark's grep baseline and its structural baseline were asked different questions — a bare
keyword versus an anchored `^name$` regex — so the comparison is not like-for-like. A corrected
measurement is pending; treat both numbers as unreliable until it lands.

Details for all three: [docs/research/discovery-2026-07-28.md](docs/research/discovery-2026-07-28.md).

## What it gives the agent (v0)

| Tool | What it does | Why it's cheap |
|------|-------------|----------------|
| `search_structure` | find symbols by name regex via a code graph | returns signatures + call-degree, not files (**~97% fewer tokens** vs grep+read, measured) |
| `retrieve` | tuned semantic chunks (small k) when you must see code | small k — naive top-k isn't a win (we measured) |
| `repo_map` | token-budgeted map of the most-referenced symbols (PageRank proxy) | orient in a repo without listing/reading files |
| `get_context` | read the module's **Context Pack** (`.context/*.md` living docs) | digested domain knowledge, not source |
| `update_context` | persist what you learned to `.context/domain_logic.md` (CCI) | next agent reads ~1k tokens, not the module |

> Design finding baked in: the token win comes from **structural retrieval + routing**, not from
> bolting on a vector DB. `search_structure` is the default; semantic is tuned and secondary.

### Continuous Context Integration (CCI)
`get_context`/`update_context` turn the repo into a **living knowledge base**: after finishing a
task, the agent writes the distilled domain logic (business rules, decisions, gotchas) into
`<module>/.context/domain_logic.md`, staged into the PR so **code review = context review**. Next
sprint, an agent reads that ~1k-token Context Pack instead of the whole module. The synthesis is
done by the agent's own model — no extra API key needed.

## Requirements
- [Bun](https://bun.sh) ≥ 1.3
- **codebase-memory-mcp** binary (structural graph). Grab just the binary (don't run its installer,
  which reconfigures your agents):
  ```bash
  curl -fsSL https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-linux-amd64-portable.tar.gz | tar -xz -C ~/.local/bin
  ```
- **semble** (semantic, optional): `uv tool install semble`

The server auto-locates both (PATH, `~/.local/bin`, or this repo's `bench/.tools/`). Override with
`ECO_CBM_BIN` / `ECO_SEMBLE_BIN`.

## Install
```bash
git clone https://github.com/tyler-void/eco-mcp
cd eco-mcp && bun install
bun run test:client          # smoke test: spawns the server, lists + calls tools
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

`ECO_WORKSPACE` is the repo the tools operate on (defaults to the server's cwd). The graph indexes
lazily on first query.

## Repo layout
- `src/` — the MCP server (this product)
- `bench/` — the accuracy-audited benchmark harness + measured results
- `docs/` — vision, research, infra, demo plan ([start here](docs/README.md))

## Status
v0: retrieval (`search_structure`/`retrieve`), the `repo_map`, and **CCI Context Packs**
(`get_context`/`update_context`) — installable. `find_concept` and `run_command` were removed
2026-07-28 (see Known issues above).
Not yet built: cache-aware egress + burn-rate meter, and model routing. See
[docs/vision/demo-plan.md](docs/vision/demo-plan.md).
