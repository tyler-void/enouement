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

`lint` distinguishing 1 from 2 matters: a hook must be able to tell "you gave me a bad argument"
from "your change has an unrecorded module", and only the second should block a commit.

## Commands

### `enou record`

Creates a knowledge record. Refuses rather than repairs.

```
enou record --kind <decision|invariant|gotcha|convention>
             --summary <one line>
             --paths <path>[,<path>...]
             [--body <text> | --body-file <path> | -]   # '-' reads stdin
             [--rejected <text>]        # required iff --kind decision
             [--supersedes <ULID>]
             [--provenance <contemporaneous|backfilled|oral>]   # default contemporaneous
             [--source <text>]          # required for backfilled and oral
             [--spec <path>] [--commit <sha>]...
             [--json]
```

**Refusals** (exit 1, nothing written): missing or over-long `--summary`; `--kind decision`
without `--rejected`; `--supersedes` naming an unknown record; missing `--source` where required;
**any secret-pattern match**, which reports which pattern matched and in which field. A refusal
must never write a partial record.

### `enou why <path-or-symbol>`

The deterministic answer. Never guesses, never synthesises.

```
enou why src/util/context.ts [--json] [--include-superseded]
```

Assembles, in this order: records whose `paths` match; records reachable through git rename
history for that path (FR-038); records referenced by `Knowledge-Record:` trailers on commits
touching it.

**Ordering**: within a supersession chain, oldest → newest follows the `supersedes` graph, not the
identifier — a record that supersedes another is newer than it by definition, and the monotonic
ULID only guarantees ordering within one process, so two machines with skewed clocks can mint IDs
whose sort contradicts the real sequence. The identifier is the deterministic tie-break between
**unrelated** records. Superseded entries are marked with the ID that replaced them (FR-009).

With no records it says so plainly and exits 0 — absence is an answer (FR-010, Principle II). A
record that fails to parse is **reported as an error in the output**, never silently omitted: an
answer that looks complete while missing a record is the confident-wrong-answer failure Principle
II prohibits.

### `enou view <module>` · `enou log <module>`

`view` renders the bounded projection: top N by kind priority then ULID descending, grouped by
kind, with an overflow line naming the `log` command. `log` renders the unbounded form with
superseded records marked. **Neither writes a file** (FR-040).

### `enou redact <ULID> --reason <text> --fields <f>[,<f>...]`

The one permitted mutation. Records `{date, reason, fields}` into the record, replaces the named
fields, and prints that the original content still exists in git history — and, when a redacted
field matched a credential pattern, that the credential must be rotated. Never automatic
(FR-033).

### `enou lint [--staged | --range <a>..<b>] [--json]`

The whole of enforcement, in one command, so the local hook and CI cannot drift apart. Reports:

| Check | Requirement |
|---|---|
| a declared module's code changed with neither a record nor a `Knowledge-None:` trailer | FR-015 |
| a record references a path, symbol or commit that no longer exists | FR-016 |
| an existing record file changed by anything other than a conforming redaction | FR-034 |
| a change un-covers records (declaration removed) — reports the count | FR-039 |
| two current records contradict each other | FR-018 |
| a record does not parse, or `parse → re-serialise` is not byte-identical | data-model §2.8 |
| a parsed value has the wrong type (`commits` not hex strings, `date` not a `YYYY-MM-DD` string) | data-model §2.8 |

Exit 2 on findings. `--json` for CI annotation. In CI, trailers are read from **the pull request's
own commits**, not only from the merged commit — a squash merge can drop a `Knowledge-None:`
trailer out of the merged trailer block (contracts/formats.md §3).

### `enou modules [add|remove|list|uncovered]`

`uncovered` answers FR-026 — which tracked paths belong to no declared module. Coverage is
deliberate, so this is how it stays honest rather than silently forgotten.

### `enou recall <query>` — v1 stub

**Exits 1 with "not implemented".** It must not return degraded BM25 results: under Principle II
a confident wrong answer is worse than no answer, and a half-tuned ranker silently returning
plausible-but-wrong records is exactly the failure that removed two tools from this repo in July.
Tuning happens in `bench/` as a separate experiment (Principle V) and ships only when measured.

## Stability

`--json` output on `why`, `view`, `lint` and `record` is a contract consumed by the hooks and CI.
Fields may be added; existing fields may not change meaning or type without a decision record.
