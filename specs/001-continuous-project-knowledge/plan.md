# Implementation Plan: Continuous Project Knowledge

**Branch**: `001-continuous-project-knowledge` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-continuous-project-knowledge/spec.md`

## Summary

Project memory as a flat, immutable, plain-text record store in the repo, with one command
surface over it and mechanical triggers around it. A record is a `<ULID>.md` file with YAML front
matter; nothing derived is ever written to disk. Reads are computed on demand: `why` walks paths,
git trailers, git rename history and the supersession chain; the bounded module view is a
deterministic projection rendered at request time and delivered to Claude Code through a
`PostToolUse(Read)` hook, and to every other agent through the CLI.

Capture is triggered by hooks and CI, never by memory (Principle VI). One `lint` command enforces
immutability, un-coverage reporting and PR flags, and is wired into **both** a local git hook and
CI — a solo developer pushing straight to `main` never opens a PR, so CI alone would guarantee
nothing.

**The whole MVP needs zero new runtime dependencies.** `Bun.YAML`, `Bun.Glob`, `Bun.$` and
`crypto.getRandomValues` are built in (probed on Bun 1.4.0, see research.md), which satisfies the
constitution's "no new runtime dependency without a decision record" without needing one.

## Technical Context

**Language/Version**: TypeScript on Bun ≥ 1.3 (measured on 1.4.0) — the existing repo stack
**Primary Dependencies**: **None new.** Bun built-ins only: `Bun.YAML` (front matter), `Bun.Glob`
(module and `formerly` path globs), `Bun.$` (git), `crypto.getRandomValues` (ULID). Existing
`@modelcontextprotocol/sdk` + `zod` stay confined to the MCP server surface.
**Storage**: Plain files in the repo — `.knowledge/records/<ULID>.md` (flat, one file per record,
FR-041) and `.knowledge/modules.yaml` (declarations, `formerly` aliases, per-module overrides).
No database, no index file, no generated artefact committed.
**Testing**: `bun test`, extending the existing `test/` suite; `test/client.ts` continues to
assert the MCP tool list exactly.
**Target Platform**: Linux/macOS developer machines and CI runners. Fully offline; no daemon, no
persistent service, no network call on any path.
**Project Type**: CLI + git hooks + CI check + spec-kit extension + MCP server (five surfaces,
one core library).
**Performance Goals**: `why` p95 < 200 ms at the 10-year volume. **Measured**: a brute-force scan
with real `Bun.YAML` parsing over a synthetic corpus costs 16 ms at 1k records, **153 ms at 10k**,
780 ms at 50k (method in research.md). No index is built in v1; the measured revisit trigger is
~25k records.
**Constraints**: Offline; no generated file committed; every path reachable from the CLI
(FR-022); the projection byte-identical on any machine (FR-032); records immutable except for a
conforming redaction (FR-033/FR-034).
**Scale/Scope**: **Derived** ~10⁴ records over a 10-year repo life (derivation in research.md —
this is derived, not measured, and is the number most likely to be wrong). Measured headroom to
50k. MVP is User Stories 1+2; US3, US4, US5 follow as separate increments.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.1.0.

| # | Principle | Gate | Status |
|---|-----------|------|--------|
| I | Measure, Don't Assume | No performance or volume claim in this plan may be unlabelled | **PASS** — latency is *measured* (method + numbers in research.md); record volume is labelled *derived* with its arithmetic shown; git cost at scale is labelled *unmeasured* and carries an explicit task rather than an estimate |
| II | A Wrong Answer Is Worse Than No Answer | No shipped path may return a confident wrong answer | **PASS with a condition** — `recall` ships as a stub in v1, and the stub MUST refuse with "not implemented" rather than return degraded BM25 hits. A stub that silently returns bad results would violate this principle outright. Recorded as a binding condition below |
| III | Knowledge Lives in the Repo | Plain text, offline, CLI equivalent for every path, CI-reproducible | **PASS** — records and declarations are plain text in-repo; no network on any path; the CLI is the primary surface and the hooks call it; the lint runs identically locally and in CI |
| IV | Supersede, Never Erase | Records immutable; corrections by supersession; redaction the sole exception, and stated | **PASS** — enforced mechanically by `lint`, not merely documented (FR-034). Redaction records `{date, reason, fields}` and says the original survives in git history |
| V | Research Is Separate and Free to Fail | Measurement and tuning live in `bench/`, not the product | **PASS** — BM25 `recall` tuning is a `bench/` experiment; the product ships the deterministic `why` only |
| VI | Capture and Projection Are Mechanical | Hooks and CI trigger capture; every view is a deterministic projection; model-based capability opt-in and never required | **PASS** — capture fires from spec-kit `after_implement` and a session hook; the view is a string sort over ULIDs plus a fixed selection rule with no model in the path; no model-based capability ships in v1 at all |
| — | Operating Constraints: offline, no new dependency without a decision record | Zero new runtime dependencies | **PASS** — probed empirically, not assumed (research.md §4) |
| — | Operating Constraints: link, don't copy | Records link to commits/specs/PRs rather than duplicating | **PASS** — `why` derives from git rather than restating it; records carry commit refs, not commit content |

**Binding conditions carried into tasks.** These are required tasks, not suggestions. Each exists
because something would otherwise fail silently:

| # | Test | Why it is mandatory |
|---|---|---|
| 1 | `recall` refuses with "not implemented" and returns no results | a half-tuned ranker returning plausible-but-wrong records is the Principle II failure that removed two tools from this repo in July |
| 2 | An `oral` record is excluded from SC-002's denominator and scored by content (SC-002a) | otherwise it is counted a miss for a citation that could never exist |
| 3 | The implementing commit is derived via `git log --diff-filter=A`, and still resolves after a squash, a rebase and an amend | a stored SHA does not survive these; this is the whole reason it is derived |
| 4 | `lint` reads `Knowledge-None:` trailers from a PR's own commits, and still finds one after a squash merge recomposes the message | reading only the merged commit flags correctly-declared changes, which trains reviewers to ignore the check |
| 5 | The canonical writer double-quotes every string scalar; `parse → re-serialise` is byte-identical | measured: unquoted `0123456` becomes the number `123456` and `#42 fixed` becomes `null` — both silent (research.md §9) |
| 5a | **Fixture: exponent-form short SHAs.** `6e40653` and `9e99999` must round-trip as strings; unquoted they parse as `Infinity` and serialise back as `null`. `1e10` and `0e12345` must round-trip; unquoted they become numbers | the worse half of the 5.59% of 7-char SHAs destroyed unquoted — an all-digit SHA at least survives as a wrong number, an exponent-form one vanishes entirely |
| 6 | Type validation after parsing rejects a numeric `commits` entry and a non-`YYYY-MM-DD` `date` | parsing succeeding does not mean the value is right |
| 7 | A record that fails to parse fails `lint` **and** is reported by `why` | an answer that looks complete while silently omitting a record is the confident-wrong-answer failure |
| 8 | Ordering within a supersession chain follows the `supersedes` graph, verified with IDs deliberately minted out of clock order | the monotonic ULID orders within one process only; skewed clocks across machines would otherwise reorder history |
| 9 | `SessionEnd` and `PreCompact` firing for one session capture at most once | prior art hit this with a single guard and still double-wrote (research.md §1) |
| 10 | `after_implement` capture runs before the git extension's auto-commit | inverted, every `Knowledge-Record:` trailer points one commit late — a silent corruption |

**No violations. Complexity Tracking is empty and the section is omitted.**

### Post-design re-check (after Phase 1)

Re-evaluated against the artefacts actually produced. All eight gates still pass. Three things the
design surfaced that the pre-design check could not see:

1. **The one spec/plan inconsistency is now reconciled.** The data model's third provenance
   value, `oral`, was a divergence from FR-036. FR-036 has been amended to admit it, FR-036a
   defines how the three populations are measured, and SC-002a scores `oral` retrieval **by
   content** — `oral` records are excluded from SC-002's denominator, since they have no commit
   and a miss there would score a link that could never exist. Both documents record the
   divergence rather than erasing it (Principle IV).
2. **`Bun.YAML` being built in removed the only likely dependency argument.** Had it been absent,
   a YAML parser would have needed a decision record under Operating Constraints; probing rather
   than assuming (research.md §4) meant the question resolved to "no dependency" instead of "which
   dependency".
3. **Prior art changed a decision rather than confirming one.** Reading cairnkeep's monotonic
   history keys exposed that plain ULID orders same-millisecond records by random bits, not by
   creation order — deterministic, so FR-032 held, but not chronological, which FR-027a needs. The
   ID decision is amended to the **monotonic ULID variant**. Prior art also supplied two hard
   constraints for the US4 increment (Claude Code's ~1.5 s `SessionEnd` budget; `SessionEnd` and
   `PreCompact` double-firing) and one open question worth carrying: all three projects
   independently built a human accept gate between extraction and storage, which we do not have.
   Our answer — the committed store makes the PR diff the gate — is recorded in research.md §1
   along with the case where it does not hold.
4. **The agent context now points at the constitution.** Updating the managed `SPECKIT` block in
   `CLAUDE.md` closes the ⚠ PENDING item carried in the constitution's Sync Impact Report since
   v1.0.0 — and does it through the block spec-kit manages, rather than writing around it, which
   is what Principle III required.

## Project Structure

### Documentation (this feature)

```text
specs/001-continuous-project-knowledge/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── cli.md           # command surface — every other surface calls it
│   ├── formats.md       # record file, module declarations, git trailers
│   └── hooks.md         # git, spec-kit and Claude Code hook contracts
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── server.ts                  # existing MCP server; gains knowledge tools in a later increment
├── knowledge/                 # the core library — no I/O policy, no agent assumptions
│   ├── id.ts                  # ULID: time-sortable + collision-free (FR-029)
│   ├── record.ts              # parse/serialise one record; front-matter contract
│   ├── store.ts               # flat store: list, read, append. Never mutates (FR-007)
│   ├── modules.ts             # declarations, `formerly` globs, per-module overrides (FR-024/037/041)
│   ├── secrets.ts             # deterministic offline patterns; refuse-on-match (FR-035)
│   ├── redact.ts              # the single permitted mutation (FR-033)
│   ├── why.ts                 # paths + trailers + rename history + supersession (FR-008/009/038)
│   ├── view.ts                # bounded deterministic projection (FR-027*)  — increment 2
│   ├── recall.ts              # v1 stub: refuses, never guesses (Principle II)
│   └── lint.ts                # immutability, un-coverage, PR flags (FR-034/039/015/016)
├── cli/
│   └── main.ts                # single entry point; every capability reachable here (FR-022)
└── util/                      # existing: bin.ts, context.ts

.knowledge/                    # the store itself, committed with the code
├── records/<ULID>.md
└── modules.yaml

.specify/extensions/knowledge/ # spec-kit extension: before_specify, before_plan, after_implement
.githooks/pre-commit           # local half of enforcement
.github/workflows/knowledge.yml# CI half of enforcement

test/
├── client.ts                  # existing MCP smoke client
├── id.test.ts  record.test.ts  store.test.ts  modules.test.ts
├── secrets.test.ts  redact.test.ts  why.test.ts  lint.test.ts
└── fixtures/                  # seeded secret shapes, synthetic corpora
```

**Structure Decision**: One core library under `src/knowledge/` with five thin surfaces over it
(CLI, git hook, CI, spec-kit extension, MCP server). The library holds every rule; a surface only
translates. This is what makes FR-022 cheap — the CLI is not a fallback bolted on afterwards, it
is the surface the hooks themselves call — and it is what lets the lint behave identically in a
pre-commit hook and in CI, which FR-034 and FR-039 both depend on.

The store lives at `.knowledge/` rather than a name derived from the project, because the project
name is unsettled (see research.md §7) and a directory is expensive to rename once real records
reference it.

## Task ordering constraints

`/speckit-tasks` MUST respect these. Each exists because reversing it produces a failure that
cannot be repaired afterwards.

1. **Foundation before any writer.** The ID generator, the canonical writer/parser and the
   round-trip lint land **before** any command that can write a record. Otherwise records exist
   in a non-canonical form before the rule exists, and FR-034's immutability means they can never
   be rewritten into it — only superseded. There is no migration path, so there is no second
   chance at this ordering.
2. **The blind protocol is a task, and it comes first.** The evaluation question set and its known
   answers are written and committed as **their own task, before any backfill task**. Every
   backfill task must state that it does not read that file. Commit order in this repository is
   the evidence; if a backfill lands first, SC-002/SC-002a/SC-003 results are **void** and cannot
   be rescued by re-running them — the knowledge of the questions is already in the backfiller.
3. **MVP order**: foundation → **US1** (record, secret scan, spec-kit `after_implement` capture)
   → **US2** (`why`). MVP checkpoint here. **US3** (views), **US4** (capture outside spec-kit) and
   **US5** (PR flags) are separate phases after that checkpoint, each independently shippable.
