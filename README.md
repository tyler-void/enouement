# Eco-MCP

**Project memory for AI coding agents, over MCP.** Two tools: the agent reads a module's
**Context Pack** before it works, and writes back what it learned when it's done. The knowledge
lands in your repo, next to the code, and goes through code review like everything else.

## Scope (narrowed 2026-09-21)

This started as a token-thrifty *gateway* wrapping retrieval backends. That premise expired:
codebase-memory-mcp, semble and rtk each ship their own MCP server, skills and hooks now, so
wrapping them added nothing, and Claude Code loads nested `CLAUDE.md`/`AGENTS.md` on demand,
which covers the read side of project memory.

What is still unsolved is the **write** side — nobody writes the knowledge back — so that is the
whole product. `search_structure`, `retrieve` and `repo_map` were removed; the retrieval research
continues in [`bench/`](bench/README.md), as measurement, not as shipped tools.

## What it gives the agent

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
git clone https://github.com/tyler-void/eco-mcp
cd eco-mcp && bun install
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
- `src/` — the MCP server (this product)
- `bench/` — the accuracy-audited benchmark harness + retrieval experiments
- `docs/` — vision, research, infra, demo plan ([start here](docs/README.md))

## Status
The two CCI tools are installable and covered by `bun run test:client`. Next, per
[docs/vision/vision.md](docs/vision/vision.md): make the write side automatic (a Stop hook and a
skill) rather than something the agent has to remember to call. Superseded and not being built:
the cache-aware egress meter and model routing from the gateway era.
