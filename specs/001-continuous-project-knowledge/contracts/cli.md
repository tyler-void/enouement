# Contract: Command surface

**Phase 1 output.** The CLI is not a fallback bolted on for non-Claude agents — it is the surface
every other surface calls. The git hook, the CI job, the spec-kit extension and the MCP server all
shell into these commands, which is what makes FR-022 true by construction rather than by
discipline.

> **The binary is `enou`.** Naming settled 2026-09-21 (research.md §7): package `enouement`,
> binary `enou`. Every invocation below is what a **consumer repo** runs, so it must be the real
> binary — `bun run knowledge` resolves only inside this repository and would break everywhere
> else. This repo keeps `bun run knowledge` as a dev alias and gains an `enou` bin entry alongside
> the legacy `eco-mcp` one; `bun link` then puts `enou` on PATH (verified, research.md §7).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success; for `lint`, nothing to report |
| 1 | refused — invalid input, failed validation, secret detected |
| 2 | `lint` found something a reviewer must see |
| 3 | internal error — the tool itself failed; the message says what, on stderr |

`lint` distinguishing 1 from 2 matters: a hook must be able to tell "you gave me a bad argument"
from "your change has an unrecorded module", and only the second should block a commit. Exit 3
blocks as well: a lint that cannot run must not look like a lint that passed (contracts/hooks.md
§5). So: **1 does not block; 2 and 3 do.**

**3 is separate from 1 on purpose.** An uncaught exception that exits 1 is indistinguishable from
a refusal, so a broken tool looks like a careful one. Every command catches its own failures and
exits 3 with the reason; a stack trace is printed only when `ENOU_DEBUG` is set.

## Repository root

Every command resolves the repository root the same way: `ENOU_ROOT` if set; otherwise the
nearest ancestor of the current directory that contains `.knowledge/`; otherwise the git top
level. Running a command from a subdirectory therefore behaves exactly as running it from the
root. Path arguments are interpreted relative to the **current directory** and then expressed
repository-relative, so `cd src && enou why util/context.ts` asks about `src/util/context.ts`.

## One definition per command

Each command is declared once — name, arguments, types, enums, ranges, which are repeatable —
and that single declaration produces the CLI flag parser, the MCP tool's input schema, and the
validation both run. Neither surface validates anything the other does not, and an unknown
argument is an error on both, never silently dropped. Both render the same result with the same
serialiser, so for the same valid input the CLI's stdout and the MCP tool's text are the same
bytes (the CLI adds one trailing newline).

This is tested at the process level — the real `enou` binary and the real MCP server over stdio,
compared byte for byte — not only by calling the shared function twice in one process, which
cannot catch a difference in argument handling.

Flag grammar, for every command: `--name value` or `--name=value`; a boolean is bare `--name`; a
repeatable flag may be given more than once; `-` as the value of a file argument reads stdin;
`--help` on any command prints its usage and exits 0.

## Commands

### `enou record`

Creates a **draft** in `.knowledge/inbox/` (FR-043). It never writes a record — there is no flag
that does. Refuses rather than repairs.

```
enou record --kind <decision|invariant|gotcha|convention>
             --summary <one line>
             --paths <path>[,<path>...]
             [--symbol <path>#<name>]...   # FR-047, optional
             [--body <text> | --body-file <path> | -]   # '-' reads stdin
             [--rejected <text>]        # required iff --kind decision
             [--supersedes <ULID>]      # must name a record, not a draft
             [--provenance <contemporaneous|backfilled|oral>]   # default contemporaneous
             [--source <text>]          # required for backfilled and oral
             [--spec <path>] [--commit <sha>]...
             [--json]
```

**Refusals** (exit 1, nothing written): missing or over-long `--summary`; `--kind decision`
without `--rejected`; `--supersedes` naming anything other than an existing record; a malformed
`--symbol`; a path that is absolute, contains `..`, or otherwise fails normalisation; missing
`--source` where required; **any secret-pattern match**, which reports which pattern matched and
in which field. A refusal must never write a partial draft.

**Output**: the draft's identifier and path. `--json` adds every field as written. The
identifier is returned on every surface — a caller that cannot learn the id it just created
cannot supersede it later.

### `enou drafts` · `enou accept` · `enou reject`

```
enou drafts [--paths <path>[,<path>...]] [--json]
enou accept <ULID>... [--json]
enou reject <ULID>... [--json]
```

`drafts` lists what is waiting, oldest first, with each draft's summary and paths.

`accept` is the **only** way a record comes into existence (FR-044). For each id it validates the
draft again — summary cap, kind rules, path normalisation, `supersedes` target and the no-fork
rule of FR-046a, and the secret scan, because the draft may have been edited by hand — then writes
`records/<ULID>.md` canonically and removes `inbox/<ULID>.md`. Ids are processed in order; one
refusal (exit 1, reason per id) stops nothing already accepted and accepts nothing after it, so
the output always says exactly which ids became records.

`reject` deletes drafts. It never touches `records/`: rejecting a record is not a thing — a record
is superseded or redacted (FR-046).

**None of `accept`, `reject` or `redact` is exposed to agents through MCP** (FR-044a) — each is a
person's step. Because an agent with a shell can still run them, the documented setup for Claude
Code adds permission deny rules for `enou accept`, `enou reject` and `enou redact`; any setup
command that writes agent configuration (spec 002) MUST write all three.

### `enou show <ULID>`

One record or draft, rendered with its **computed** status — current, superseded by whom, or
draft — and its derived implementing commit. This is not "open the raw file": a raw file cannot
show that a later record superseded it (FR-040a), and `show` can.

### `enou why <path-or-symbol>`

The deterministic answer. Never guesses, never synthesises.

```
enou why <path-or-symbol> [--include-superseded] [--include-drafts] [--json]
```

Assembles, in this order: records whose `paths` match; records reachable through git rename
history for that path (FR-038); records referenced by `Knowledge-Record:` trailers on commits
touching it. Every id found by any of the three is resolved through the trust predicate
(data-model §2.2): a trailer naming a draft or a rejected draft contributes nothing.

**Ordering**: within a supersession chain, oldest → newest follows the `supersedes` graph, not the
identifier — a record that supersedes another is newer than it by definition, and the monotonic
ULID only guarantees ordering within one process, so two machines with skewed clocks can mint IDs
whose sort contradicts the real sequence. The identifier is the deterministic tie-break between
**unrelated** records. Superseded entries are marked with the ID that replaced them (FR-009).

With no records it says so plainly and exits 0 — absence is an answer (FR-010, Principle II). A
record that fails to parse is **reported as an error in the output**, never silently omitted: an
answer that looks complete while missing a record is the confident-wrong-answer failure Principle
II prohibits.

**Path or symbol.** `<path>#<name>` is always a symbol. Otherwise the argument is a **path** if any
of these holds: it exists in the working tree; it matches a record's `paths` or a module's
`formerly` globs; or git history has ever tracked it (`git log --all -- <arg>` is non-empty). Only
an argument that is none of these is a symbol. The order matters: a deleted or renamed file must
still answer from its records (FR-037, FR-038, and the deleted-file edge case), not fall through to
a definition search that finds nothing.

**Symbols** (FR-047). Resolution, in order, and the **one-file rule** applies at each step:

1. Records whose `symbols` declare it — exact match on name, and on path when one is given. If the
   declaring records anchor the name to **one** file, answer with them. If they anchor it to more
   than one file, list those files and return **no records** — a declaration does not make an
   ambiguous name unambiguous.
2. Otherwise a **literal definition search** over the tracked files at `HEAD` (`git grep`, fixed
   per-language definition patterns, whole-word exact name). Exactly one defining file → that
   file's answer, as above. Several → the candidates are listed (`path:line`), **no records are
   returned**, and the answer asks for `<path>#<name>`. None → "no definition found", exit 0.

The search works at any revision with no checkout and no index, so nothing can be stale. A
definition the patterns cannot see (a member nested in another definition, say) is a missing
answer, never a wrong one.

**Drafts**: never included unless `--include-drafts`, and then each is labelled `draft` (FR-045).

### `enou brief <path>...`

```
enou brief <path>... [--include-drafts] [--json]
```

The pre-work briefing of FR-048 — what an agent or a person should know before touching these
paths. Deterministic: no ranking, no model; the same records and paths give the same bytes.

| Section | Content |
|---|---|
| records | the accepted records affecting any of the paths — the `why` answer for each, deduplicated by id |
| views | the current-truth view of each declared module the paths fall in, once per module |
| gaps | one entry per finding, each `{check, path or module, detail}` |
| checked | **every** check that ran, always present, in a fixed order |

Gap checks: `uncovered-path` (a path in no declared module), `module-without-knowledge`,
`drafts-waiting` (drafts touching these paths), `contradiction` (FR-018, among current records
in these modules), `dangling-reference` (FR-016, among the records listed). The `checked` list is
what distinguishes "nothing found" from "not looked for"; a brief with an empty `checked` list is
a bug, not a clean bill of health.

The spec-kit `before_specify` and `before_plan` prompts call `brief` over the paths the feature is
expected to touch (contracts/hooks.md §2).

### `enou view <module>` · `enou log <module>`

```
enou view <module> [--include-drafts] [--json]
enou log <module> [--include-drafts] [--json]
```

`view` renders the bounded projection: top N by kind priority then ULID descending, grouped by
kind, with an overflow line naming the `log` command. `log` renders the unbounded form with
superseded records marked. **Neither writes a file** (FR-040). With `--include-drafts`, drafts
are listed in their own section after the records, each labelled `draft`, and never count toward
N (FR-045).

### `enou redact <ULID> --reason <text> --fields <f>[,<f>...]`

The one permitted mutation. Records `{date, reason, fields}` into the record, replaces the named
fields, and prints that the original content still exists in git history — and, when a redacted
field matched a credential pattern, that the credential must be rotated. Never automatic
(FR-033).

### `enou lint [--staged | --range <a>..<b>] [--json]`

The whole of enforcement, in one command, so the local hook and CI cannot drift apart. Reports:

| Check | Requirement |
|---|---|
| a declared module's code changed with neither an **accepted** record nor a `Knowledge-None:` trailer — a `Knowledge-Record:` trailer counts only for ids the trust predicate accepts | FR-015 |
| a record references a path, symbol or commit that no longer exists | FR-016 |
| an existing record file changed by anything other than a conforming redaction | FR-034 |
| a change un-covers records (declaration removed) — reports the count | FR-039 |
| two current records contradict each other | FR-018 |
| a record does not parse, or `parse → re-serialise` is not byte-identical | data-model §2.8 |
| a parsed value has the wrong type (`commits` not hex strings, `date` not a `YYYY-MM-DD` string) | data-model §2.8 |
| a record file was added under `records/` that does not pass capture validation — accepting is the only way in, so anything else is a hand-placed file | FR-044 |
| the same ULID exists in both `inbox/` and `records/` | data-model §1 |
| a declared symbol's file, followed through renames, is gone or no longer defines the name — a rename alone is never a finding (FR-037) | FR-016, FR-047 |
| *(information, never a finding)* drafts waiting, with the paths they touch; for an FR-015 flag, the draft that would close it once accepted | FR-050, FR-015 |

Exit 2 on findings. Drafts waiting never cause exit 2 on their own.

`lint` reads the store **once** and checks every file against that in-memory set, so it is linear
in the number of records. A per-file check that re-reads the whole store is quadratic. *Derived*
from research.md §3 (~15 µs per record parsed): one pass over the 10⁴-record design volume costs
about 0.15 s; one full re-read per record is 10⁴ such passes, about 25 minutes.

`--json` for CI annotation. In CI, trailers are read from **the pull request's
own commits**, not only from the merged commit — a squash merge can drop a `Knowledge-None:`
trailer out of the merged trailer block (contracts/formats.md §3).

### `enou modules [add|remove|list|uncovered]`

`uncovered` answers FR-026 — which tracked paths belong to no declared module. Coverage is
deliberate, so this is how it stays honest rather than silently forgotten.

### `enou recall <query>` — v1 stub, with a defined way out

**Exits 1 with "not implemented".** It must not return degraded BM25 results: under Principle II
a confident wrong answer is worse than no answer, and a half-tuned ranker silently returning
plausible-but-wrong records is exactly the failure that removed two tools from this repo in July.
Tuning happens in `bench/` as a separate experiment (Principle V) and ships only when measured.

**What replaces the stub, and when** (FR-049, research.md §13). The stub is replaced only when a
ranker built in `bench/` meets thresholds registered before it was built, on a blind judged set.
The shipped command then returns, for each hit, the record id and summary and a term-by-term
explanation `{term, field, tf, idf, contribution}` whose contributions sum to the score; ranks only
accepted current records; and returns `{abstained: true, reason}` instead of hits when the
separate abstention rule fires. Until then this section is the whole contract.

## MCP server

The MCP server is a thin surface over the same command definitions. Its tool list is **exactly**:

| Tool | Command |
|---|---|
| `why` | `enou why` |
| `view` | `enou view` |
| `log` | `enou log` |
| `brief` | `enou brief` |
| `show` | `enou show` |
| `drafts` | `enou drafts` |
| `record` | `enou record` — creates a draft |

Deliberately absent: `accept`, `reject`, `redact` (FR-044a) — a person's steps; `lint` — CI and git
hooks run it; `recall` — until it ships. The legacy Context Pack tools `get_context` and
`update_context` are **removed** by this feature and replaced by the tools above: authored module
prose stops being a source of truth once the view is projected from records (spec.md,
Assumptions). The removal is recorded in the commit that makes it and in research.md §1's
Cautionary note, per the constitution's Development Workflow. `test/client.ts` asserts this list
exactly, so a removed tool cannot quietly return and an excluded one cannot quietly appear.

## Stability

`--json` output on `why`, `view`, `brief`, `show`, `drafts`, `lint`, `record` and `accept` is a
contract consumed by the hooks, CI and the MCP server. Fields may be added; existing fields may
not change meaning or type without a decision record. Every field name is `snake_case` on every
surface.
