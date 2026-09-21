# Quickstart: Continuous Project Knowledge

**Phase 1 output.** What using this looks like once the MVP (User Stories 1+2) ships. Commands run
as `bun run knowledge <cmd>` in v1 — no global binary is claimed while the project name is
unsettled (research.md §7).

## Install into a repository

```bash
# 1. declare what a module is — nothing is covered until it is declared (FR-024)
cat > .knowledge/modules.yaml <<'YAML'
defaults:
  view: { max_records: 20, max_summary: 120 }
modules:
  - path: src/knowledge
  - path: src/util
YAML

# 2. wire enforcement into BOTH halves — neither alone is sufficient
git config core.hooksPath .githooks     # local: catches work that never opens a PR
# CI: .github/workflows/knowledge.yml runs the identical `lint`

# 3. check what is not covered, on purpose or otherwise
bun run knowledge modules uncovered
```

## Record something

```bash
bun run knowledge record \
  --kind decision \
  --summary "retrieval tools removed; the wrapped tools ship their own MCP servers now" \
  --paths src/server.ts,src/backends/ \
  --rejected "keep the gateway and re-measure it" \
  --spec specs/001-continuous-project-knowledge/spec.md \
  --commit 7c000ac
```

Writes `.knowledge/records/01JBQ7K3M2N8P4R6T9V0W1X2Y3.md`. You review it in the PR diff like any
other file — that is the whole review mechanism (FR-020).

It **refuses**, writing nothing, if the summary is missing or over the cap, if a `decision` has no
rejected alternative, or if anything in it matches a secret pattern. A refusal names what
tripped it.

## Ask why

```bash
$ bun run knowledge why src/server.ts

src/server.ts — 3 records

01JAX…  2026-06-09  decision   [superseded by 01JBQ7…]
        gateway wraps retrieval backends behind one tool surface
        spec: SPEC.md · commits: 24cf7b3

01JB2…  2026-07-28  gotcha
        codebase-memory-mcp 0.7.0 ignores semantic_query and returns the whole symbol table
        commits: 52d5957

01JBQ7… 2026-09-21  decision
        retrieval tools removed; the wrapped tools ship their own MCP servers now
        spec: specs/001-continuous-project-knowledge/spec.md · commits: 7c000ac
        supersedes 01JAX…
```

Oldest first, superseded entries marked with what replaced them (FR-009). It follows git rename
history, so a file that moved still answers (FR-038). With no records it says so — it does not
infer a rationale from the code (FR-010).

## What a reviewer sees

A PR touching `src/knowledge/` with no record and no trailer:

```
knowledge: src/knowledge changed with no knowledge recorded
  → add a record:  bun run knowledge record --paths src/knowledge/...
  → or say it taught nothing, in the commit message:
        Knowledge-None: routine dependency bump
```

The second is not a dismissal — it is part of the change, visible in the diff, and counted
(FR-017, FR-030). Either one clears the flag; nothing is clicked away.

## Later increments

| Increment | What it adds |
|---|---|
| US3 | the bounded module view, delivered to Claude Code via `PostToolUse(Read)` and to every other agent via `knowledge view` |
| US4 | capture offered at session end for work done outside spec-kit, at most once per session |
| US5 | the PR flags above, produced by CI as well as the local hook |

## Two things that are deliberately not here

- **`knowledge recall`** exits 1 with "not implemented". A half-tuned ranker returning
  plausible-but-wrong records is the failure that removed two tools from this repo in July;
  tuning happens in `bench/` and ships when measured (Principles II and V).
- **No generated file is written anywhere.** The view and the full log are rendered on demand and
  never committed, so nothing on disk can drift from the records it came from.
