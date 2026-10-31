# Quickstart: Continuous Project Knowledge

**Phase 1 output.** What using this looks like once the MVP (User Stories 1+2) ships. The binary
is `enou` (package `enouement` — naming settled 2026-09-21, research.md §7). Everything below runs
in a **consumer** repository, so it calls the real binary; `bun run knowledge` is a dev alias that
works only inside this repository.

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
# CI: .github/workflows/enouement.yml runs the identical `lint`

# 3. check what is not covered, on purpose or otherwise
enou modules uncovered
```

## Personal install (manual) — T056

`enou init` is spec 002; until then a repository is set up by hand, and the enouement skill
(`.claude/skills/enouement/`) walks an agent through the same steps. The authoritative guide is
[`.claude/skills/enouement/references/setup.md`](../../.claude/skills/enouement/references/setup.md);
in short:

- **(a) Put `enou` on PATH**: `bun install && bun link` in a clone of this repository puts `enou`
  in `~/.bun/bin` (it symlinks the `package.json` bin and runs the `.ts` entry through its shebang).
- **(b) spec-kit repositories**: `specify extension add <this repo>/.specify/extensions/enouement --dev`,
  through the CLI — never by hand-editing `.specify/extensions/.registry` (it carries a manifest hash).
  Then check `after_implement` lists `enouement` before `git` in `.specify/extensions.yml`.
- **(c) Claude Code hooks**: merge the settings block from the guide into `.claude/settings.json`
  (or the user-scope `~/.claude/settings.json`). Every hook starts with a POSIX-sh pre-filter, so in
  a repository without `.knowledge/`, or on a machine without `enou`, it costs one `sh` and prints
  nothing; no hook makes a network call.
- **(d) Modules**: `enou modules add <path>` per module; nothing is covered until it is declared.
- **(e) Deny rules**: the same settings block denies the agent `enou accept`, `enou reject` and
  `enou redact` — acceptance stays the person's step (FR-044a). The loop is: the agent captures,
  you run `enou drafts`, read, edit if needed, `enou accept <id>`.
- **(f) Tools that replace `Read`**: some code-intelligence MCP servers tell the agent to read code
  through their own tools, which stops the read hook firing. The session-start line still names the
  modules that have knowledge, and `enou brief` / `enou view` are always the explicit path.

## Record something

```bash
enou record \
  --kind decision \
  --summary "retrieval tools removed; the wrapped tools ship their own MCP servers now" \
  --paths src/server.ts,src/backends/ \
  --rejected "keep the gateway and re-measure it" \
  --spec specs/001-continuous-project-knowledge/spec.md \
  --commit b4563b3
```

Writes a **draft**, `.knowledge/inbox/01JBQ7K3M2N8P4R6T9V0W1X2Y3.md`, and prints its id. Nothing
reads drafts as knowledge yet — not `why`, not views, not the agent hook (FR-045).

It **refuses**, writing nothing, if the summary is missing or over the cap, if a `decision` has no
rejected alternative, or if anything in it matches a secret pattern. A refusal names what
tripped it.

## Accept it

Most drafts are written by your agent — at the end of a spec-kit feature, or when a session ends
— not typed by hand. Either way, a draft becomes knowledge only when you say so:

```bash
enou drafts                       # what is waiting, oldest first
$EDITOR .knowledge/inbox/01JBQ7….md   # fix anything the agent got wrong
enou accept 01JBQ7K3M2N8P4R6T9V0W1X2Y3
```

`accept` checks the draft again — your edit could have added a secret or broken a rule — then
moves it to `.knowledge/records/` under the same id. From then on it is immutable: you correct it
by superseding it, never by editing it. `enou reject <id>` throws a draft away.

The agent cannot accept for you: the MCP server has no such tool, and the Claude Code setup adds
deny rules for `enou accept`, `enou reject` and `enou redact` (contracts/hooks.md §3, "Denying
acceptance to agents"). In a pull request, the
reviewer sees the move from `inbox/` to `records/` in the diff.

## Ask why

```bash
$ enou why src/server.ts

src/server.ts — 3 records

01JAX…  2026-06-09  decision   [superseded by 01JBQ7…]
        gateway wraps retrieval backends behind one tool surface
        spec: SPEC.md · commits: 6a77457

01JB2…  2026-07-28  gotcha
        codebase-memory-mcp 0.7.0 ignores semantic_query and returns the whole symbol table
        commits: 569da42

01JBQ7… 2026-09-21  decision
        retrieval tools removed; the wrapped tools ship their own MCP servers now
        spec: specs/001-continuous-project-knowledge/spec.md · commits: b4563b3
        supersedes 01JAX…
```

Oldest first, superseded entries marked with what replaced them (FR-009). It follows git rename
history, so a file that moved still answers (FR-038). With no records it says so — it does not
infer a rationale from the code (FR-010).

Asking about a symbol works too — `enou why buildContext`. If a record declares it, that record
answers; otherwise the definition is found by a literal search of the tracked files. If the name
is defined in two places, you get both locations and no answer until you pick one
(`enou why src/util/context.ts#buildContext`) — it never guesses (FR-047).

## Before you start something *(from US3)*

In the MVP, the spec-kit extension shows the `enou why` answer for each path a feature will touch.
Once module views exist, it shows a brief instead:

```bash
enou brief src/util/context.ts src/server.ts
```

The records that affect those paths, the views of their modules, and what is missing: paths no
module covers, modules with nothing recorded, drafts still waiting, and — once US5 lands —
contradictions and dangling references. It always lists the checks it ran, so an empty gap list
means "checked and clean", not "not looked at" (FR-048). The spec-kit extension runs this before a
spec is written.

## What a reviewer sees

A PR touching `src/knowledge/` with no record and no trailer:

```
knowledge: src/knowledge changed with no knowledge recorded
  → add a record:  enou record --paths src/knowledge/...   then  enou accept <id>
    (a draft alone does not clear this — the flag names it until it is accepted)
  → or say it taught nothing, in the commit message:
        Knowledge-None: routine dependency bump
```

The second is not a dismissal — it is part of the change, visible in the diff, and counted
(FR-017, FR-030). Either one clears the flag; nothing is clicked away.

## Later increments

| Increment | What it adds |
|---|---|
| US3 | the bounded module view, delivered to Claude Code via `PostToolUse(Read)` and to every other agent via `enou view`; `enou brief`; `enou show` |
| US4 | capture offered at session end for work done outside spec-kit, at most once per session |
| US5 | the PR flags above, produced by CI as well as the local hook |

## Two things that are deliberately not here

- **`enou recall`** exits 1 with "not implemented". A half-tuned ranker returning
  plausible-but-wrong records is the failure that removed two tools from this repo in July;
  tuning happens in `bench/` and ships only if it clears a bar registered before it was built
  (Principles II and V, FR-049).
- **No generated file is written anywhere.** The view and the full log are rendered on demand and
  never committed, so nothing on disk can drift from the records it came from.
