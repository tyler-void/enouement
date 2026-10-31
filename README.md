# enouement

**Repo-native, reviewed project knowledge for agent-assisted development.** The reasoning behind a
change — the decision, the rule that must hold, the gotcha that will bite again — lives in the
repository next to the code it explains, and is still there, and still findable, a year later.

Built for solo developers, small teams and solo builders. No server, no network, no API key: plain
files in your repo and a command-line tool.

## Status: pre-alpha, usable from a clone

- Spec 001 (continuous project knowledge) is implemented on the
  [`001-continuous-project-knowledge`](https://github.com/tyler-void/enouement/tree/001-continuous-project-knowledge)
  branch: capture, acceptance, `why`, `brief`, module views, the Claude Code hooks, the integrity
  check, git hooks, CI, the MCP server and the spec-kit extension.
- Not published to npm yet: install from a clone (below). Packaging is spec 002
  ([#1](https://github.com/tyler-void/enouement/issues/1)), which also renames the remaining legacy
  identifiers — the package is still called `eco-mcp`, and so is the MCP server's binary.
- `enou recall` (free-text search) deliberately refuses: it ships only once a ranker clears a bar
  registered before it was built.
- Not done yet: the blind evaluation of spec 001's success criteria. Its question sets must be written
  by the owner, outside any agent session, before any history is backfilled — so the measured claims
  that evaluation would support are not made here.

## How it works

```
agent finishes work ──enou record──▶ .knowledge/inbox/<id>.md      a DRAFT: never served as knowledge
person reads it     ──enou accept──▶ .knowledge/records/<id>.md    a RECORD: immutable, reviewed in the diff
anyone, later       ──enou why src/billing/tax.ts  /  enou brief <paths>  /  enou view <module>
```

- **Records** are small Markdown files with YAML front matter: a kind (decision, invariant, gotcha,
  convention), a one-line summary, the paths and symbols they concern, and a body saying what is true
  and why. A decision names the alternatives it rejected.
- **Agents write drafts; people accept them.** Nothing an agent captures is trusted until a person
  runs `enou accept`. Agents get no tool to do it, and the Claude Code setup denies the command.
- **Records never change.** A wrong one is *superseded* by a newer one, so the history of why things
  changed survives. Redaction is the one exception, and it says the original is still in git history.
- **Everything shown is computed from the records**, deterministically: `why` (records for a file or
  symbol, oldest first, superseded ones marked), `view` (a module's current truth, bounded), `brief`
  (what to know before touching some paths, and what is missing).
- **Claude Code hooks** put a module's view in front of the agent when it reads a file there, and
  ask once at the end of a session that changed code to capture what was learned.
- **`enou lint`** — in a pre-commit and pre-push hook and in CI — checks the store, catches edits to
  accepted records, and flags modules that changed with no knowledge recorded. A commit that taught
  nothing says so with a `Knowledge-None: <reason>` trailer.

## Install

Requires [Bun](https://bun.sh) ≥ 1.3 and git.

```bash
git clone https://github.com/tyler-void/enouement ~/src/enouement
cd ~/src/enouement && bun install && bun link     # puts `enou` (and the `eco-mcp` server) on PATH
enou --help
```

## Set it up in a repository

The full guide — store, modules, Claude Code hooks and deny rules, git hooks, MCP — is
[`.claude/skills/enouement/references/setup.md`](.claude/skills/enouement/references/setup.md). The
short version, from the root of your repo:

```bash
enou modules add src/api          # declare what a module is; nothing is covered until it is declared
enou modules add src/db
printf '.knowledge/** text eol=lf\n' >> .gitattributes
enou lint                         # no findings
```

Then merge the hooks and deny rules from the guide into `.claude/settings.json`, and link the skill
so Claude Code knows how to use it in every project:

```bash
ln -s ~/src/enouement/.claude/skills/enouement ~/.claude/skills/enouement
```

With the skill installed you can also just ask Claude Code: *"set up enouement in this repo"*.

## Commands

| Command | What it does |
|---|---|
| `enou record --kind … --summary … --paths … --body-file -` | capture a draft |
| `enou drafts` | drafts waiting for a person |
| `enou accept <id>…` / `enou reject <id>…` | a person's step: make drafts records, or discard them |
| `enou why <path \| symbol \| path#name>` | the records that shaped it, oldest first |
| `enou brief <paths>…` | records, module views and gaps for the paths you are about to change |
| `enou view <module>` / `enou log <module>` | a module's current truth / its full history |
| `enou show <id>` | one record or draft, with its status and implementing commit |
| `enou modules list \| uncovered \| add \| move \| remove` | module declarations |
| `enou lint [--staged \| --range a..b]` | the integrity check (exit 2 on findings) |
| `enou redact <id> --reason … --fields …` | a person's step: hide sensitive content in a record |
| `enou recall` | refuses until a measured ranker ships |

Exit codes: 0 ok · 1 refused (bad input, a validation failure, a secret detected) · 2 lint findings ·
3 the tool itself failed.

## Repo layout

- `src/knowledge/` — the core: record format and canonical writer, stores, trust, modules, why,
  views, brief, lint, hooks. `platform.ts` is the only file that touches Bun-specific APIs.
- `src/cli/` — the `enou` command surface; `src/server.ts` — the MCP server, generated from the same
  command definitions so both give the same bytes.
- `.claude/skills/enouement/` — the Claude Code skill and its setup guide.
- `.specify/extensions/enouement/` — the spec-kit extension (brief before a spec, capture after
  implementing).
- `.githooks/`, `.github/workflows/enouement.yml` — local and CI enforcement.
- `specs/001-continuous-project-knowledge/` — the spec, plan, contracts, research and tasks.
- `bench/` — research harnesses (latency measurements, the earlier retrieval benchmark).

Run the tests with `bun run test`.

## About the name

*Enouement* is one of John Koenig's coinages from
[The Dictionary of Obscure Sorrows](https://www.thedictionaryofobscuresorrows.com/word/enouement).
It names a particular ache: you finally reach the future and find out how things turned out — and
there is no way to carry that back to the version of you who needed it, who is still standing in
the past, still guessing.

This tool is an attempt to run the feeling backwards. It cannot send anything to your past self.
What it can do is make your past self leave the notes — recorded while the reasons were still
fresh, committed beside the code, waiting for whoever arrives next. Usually that is you.

## Known issues

- **The `~97%` / `78%` retrieval figures in the benchmark docs are under revision.** The benchmark's
  grep baseline and its structural baseline were asked different questions, so the comparison is not
  like-for-like. Treat both numbers as unreliable until a corrected measurement lands. They back no
  claim in this README; retrieval is not part of the product.
- **The read hook's "nothing to do" path misses its latency budget** — about 8.5 ms over an empty Bun
  program against a 5 ms target, all of it runtime start-up (measured; spec research §10). Closing it
  is a packaging decision for spec 002.

History: `find_concept` and `run_command` were removed on 2026-07-28 for returning confidently wrong
output; `search_structure`, `retrieve` and `repo_map` followed on 2026-09-21 with the scope change,
and the Context Pack tools (`get_context`, `update_context`) were replaced by knowledge records in
spec 001. Details: [docs/research/discovery-2026-07-28.md](docs/research/discovery-2026-07-28.md).
