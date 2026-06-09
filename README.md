# Eco-MCP Gateway

A token-thrifty **MCP server** for AI coding agents (Cursor / Claude Code / Cline / Codex). It
replaces the expensive habits that drive agentic-coding cost — `grep` + reading whole files,
dumping verbose logs — with compact, structured tools, so **cheap models can do real work**.

Born from the GitHub Copilot usage-based-billing shock (June 2026). Measured, not assumed —
see [docs/research/benchmark-results.md](docs/research/benchmark-results.md).

## What it gives the agent (v0)

| Tool | What it does | Why it's cheap |
|------|-------------|----------------|
| `search_structure` | find symbols by name regex via a code graph | returns signatures + call-degree, not files (**~97% fewer tokens** vs grep+read, measured) |
| `find_concept` | semantic search over the graph for a NL concept | compact symbol hits, no file dumps |
| `retrieve` | tuned semantic chunks (small k) when you must see code | small k — naive top-k isn't a win (we measured) |
| `run_command` | run tests/build/lint, return **failures-only** output | strips passing/INFO noise |

> Design finding baked in: the token win comes from **structural retrieval + routing**, not from
> bolting on a vector DB. `search_structure` is the default; semantic is tuned and secondary.

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
git clone --recurse-submodules https://github.com/tyler-void/eco-mcp
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
- `vendor/` — the upstream tools we build on (git submodules, MIT/Apache-2.0)

## Status
v0: retrieval + compressed command output, working and installable. Not yet built: the cache-aware
egress + burn-rate meter, model routing, and CCI / Context Packs (auto living-docs). See
[docs/vision/demo-plan.md](docs/vision/demo-plan.md).
