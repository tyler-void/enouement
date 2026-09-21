# Tasks: Continuous Project Knowledge

**Feature**: `001-continuous-project-knowledge` | **Plan**: [plan.md](plan.md) | **Spec**: [spec.md](spec.md)
**Generated**: 2026-09-21 · **Nothing in this file has been implemented.**

Tests are included because plan.md lists 14 of them as mandatory, each tied to a failure that is
silent without it.

## Ordering constraints, as dependencies

The four constraints in plan.md are enforced here by the `Depends on:` field of individual tasks,
not by the order they happen to be written in. Prose ordering is advice; a dependency is a gate.

| # | Constraint | Enforced by |
|---|---|---|
| 1 | Foundation before any writer | every task that can write a record depends on **T018** (foundation gate) |
| 2 | Blind protocol before backfill | every backfill task depends on **T019** (question set committed) |
| 3 | MVP = foundation → US1 → US2 | Phase 5 depends on Phase 4; checkpoints are tasks (**T041**, **T057**) |
| 4 | First dogfood record is the naming decision, after foundation | **T042** depends on T018 and is blocked from Phase 2 |

---

## Phase 1: Setup

- [ ] T001 Create the directory skeleton `src/knowledge/` and `src/cli/` per plan.md
- [ ] T002 Add an `enou` bin entry to `package.json` pointing at `src/cli/main.ts`, **keeping the existing `eco-mcp` bin** (legacy ids wait for spec 002 — research.md §7)
- [ ] T003 [P] Add `test:knowledge` script to `package.json` running the new suites by explicit path (a bare `bun test` walks into `bench/fixtures/`)
- [ ] T004 [P] Create `.knowledge/records/.gitkeep` and `.knowledge/modules.yaml` declaring this repo's own modules, with `defaults.view` limits

---

## Phase 2: Foundational — BLOCKING (ordering constraint 1)

**Nothing in any later phase may write a record until this phase is complete.** A record written
before the canonical writer exists can never be corrected: FR-034 makes records immutable, so a
non-canonical record could only be superseded, never rewritten. There is no migration path, which
is why this is a gate and not a recommendation.

- [ ] T005 Implement `src/knowledge/platform.ts` — the **only** file permitted to touch `Bun.*` (`Bun.YAML`, `Bun.Glob`, `Bun.$`, `Bun.file`); everything else imports from here (plan.md platform seam)
- [ ] T006 [P] Implement `src/knowledge/id.ts` — **monotonic** ULID, 26 chars, 48-bit timestamp + 80-bit randomness, random component incremented within a shared millisecond. Depends on: T005
- [ ] T007 [P] Implement `src/knowledge/secrets.ts` — deterministic offline regex patterns (private-key headers, AWS-style key ids, bearer/authorization assignments, `*_API_KEY=`). No model, no network, no entropy heuristic
- [ ] T008 Implement `src/knowledge/record.ts` — canonical writer/parser. **Double-quote every string scalar**; validate types after parsing (`commits` hex strings, `date` a `YYYY-MM-DD` string). Depends on: T005, T006
- [ ] T009 Implement `src/knowledge/store.ts` — flat store over `.knowledge/records/<ULID>.md`; list, read, append. **Never mutates.** Depends on: T008
- [ ] T010 Implement `src/knowledge/modules.ts` — declarations, `formerly` globs, per-module `view` overrides, total order-independent resolution (current `path` beats another module's `formerly`; ties by declaration order). Depends on: T005
- [ ] T011 Implement `src/knowledge/lint.ts` round-trip + immutability checks only: parse → re-serialise byte-identical, and an existing record file changed by anything other than a conforming redaction. Depends on: T008, T009

### Foundational tests (mandatory)

- [ ] T012 [P] Test (plan #8): ULID lexicographic sort equals chronological; monotonic within one millisecond; **and ordering across deliberately skewed clocks is NOT relied on** in `test/id.test.ts`. Depends on: T006
- [ ] T013 [P] Test (plan #5): canonical writer double-quotes every string scalar; `parse → re-serialise` byte-identical in `test/record.test.ts`. Depends on: T008
- [ ] T014 [P] Test (plan #5a): **SHA fixtures.** All-digit `0123456` must round-trip as a string (unquoted it becomes `123456`); exponent-form `6e40653` and `9e99999` must round-trip (unquoted they become `Infinity`, serialising back as `null`); `1e10` and `0e12345` must round-trip. 5.59% of 7-char SHAs are affected. In `test/record.test.ts`. Depends on: T008
- [ ] T015 [P] Test (plan #6): type validation rejects a numeric `commits` entry and a non-`YYYY-MM-DD` `date`; never coerces. Depends on: T008
- [ ] T016 [P] Test (plan #13): **no file outside `src/knowledge/platform.ts` references a `Bun.*` global** — a source scan, not a review convention, in `test/platform-seam.test.ts`. Depends on: T005
- [ ] T017 [P] Test (plan #7): a record that fails to parse fails `lint` and is **reported**, never silently skipped. Depends on: T011

- [ ] **T018 — GATE: foundation complete.** All of T005–T017 pass. **No task numbered above T018 that writes a record may begin until this gate is closed.** Depends on: T005, T006, T007, T008, T009, T010, T011, T012, T013, T014, T015, T016, T017

---

## Phase 3: Blind protocol — BLOCKING for measurement (ordering constraint 2)

- [ ] **T019 — Write and commit the evaluation question set** to `specs/001-continuous-project-knowledge/evaluation/questions.md`: at least 20 "why" questions drawn from this repository's history (June 2026 gateway, July 2026 tool removals, September 2026 narrowing), each with its known correct answer, agreed **before** the system is run against it. **This commit must precede every backfill commit — commit order in this repository is the evidence.** Depends on: nothing (deliberately — it must be possible to do this first)

> Every task that backfills a record depends on T019 and must state in its commit message that the
> backfill process did not read `evaluation/questions.md`. If a backfill lands first,
> SC-002/SC-002a/SC-003 are **void** and cannot be rescued by re-running them — the questions are
> already known to whoever wrote the records.

---

## Phase 4: User Story 1 — Decisions are recorded when a feature is finished (P1)

**Goal**: finishing a spec-kit feature produces knowledge records, unasked, linked to spec and commits.
**Independent test**: complete a spec-kit feature; inspect the PR diff; records exist with kind, one-line summary, rejected alternatives for decisions, no explicit request made.

- [ ] T020 [US1] Implement `enou record` in `src/cli/main.ts` — flags per contracts/cli.md; refuses rather than repairs; writes nothing on refusal. Depends on: **T018**
- [ ] T021 [US1] Wire capture-time secret scanning into `record`: refuse on match, report which pattern matched and in which field. Depends on: T020, T007
- [ ] T022 [US1] Implement derived implementing-commit resolution in `src/knowledge/why.ts` — `git log --diff-filter=A -- .knowledge/records/<id>.md` via `platform.ts`. Depends on: **T018**
- [ ] T023 [US1] Implement `enou modules list|uncovered` (FR-026). Depends on: **T018**, T010
- [ ] T024 [US1] Implement `enou redact` — explicit only, requires `--reason`, writes `{date, reason, fields}`, prints that the original survives in git history and that a credential must be rotated. Depends on: **T018**
- [ ] T025 [US1] Create the spec-kit extension at `.specify/extensions/enouement/` with `extension.yml` (**id `enouement`**, not `knowledge` — research.md §7 collision check) and register `after_implement` → `enou record`
- [ ] T026 [US1] Order `after_implement` so `enouement` runs **before** the git extension's `speckit.git.commit` in `.specify/extensions.yml`. Depends on: T025
- [ ] T027 [US1] Implement `enou recall` as a stub that **exits 1 with "not implemented"** and returns no results. Depends on: **T018**

### US1 tests

- [ ] T028 [P] [US1] Test (plan #1): `recall` refuses and returns nothing. Depends on: T027
- [ ] T029 [P] [US1] Test: `record` refuses on missing/over-long summary, on `--kind decision` without `--rejected`, on unknown `--supersedes`, and on missing `--source` for `backfilled`/`oral` — writing nothing each time. Depends on: T020
- [ ] T030 [P] [US1] Test: a seeded corpus of known secret shapes is refused at capture, with the match reported (plan test 5 of SC-012). Depends on: T021
- [ ] T031 [P] [US1] Test (plan #3): the implementing commit resolves after a **squash**, a **rebase** and an **amend** — a stored SHA would not survive these. Depends on: T022
- [ ] T032 [US1] Test (plan #10): `after_implement` capture runs before the git auto-commit; inverted, every `Knowledge-Record:` trailer points one commit late. Depends on: T026

---

## Phase 5: User Story 2 — Asking why the code is like this (P2)

**Goal**: ask why a file or symbol is as it is; get the records that shaped it, oldest to newest, superseded ones marked.
**Independent test**: ask about a file with known history; compare against the known answer.

- [ ] T033 [US2] Implement `enou why <path-or-symbol>` — assemble from `paths`, git rename history (`--follow`), and `Knowledge-Record:` trailers. Depends on: **T018**, T022
- [ ] T034 [US2] Implement supersession-chain ordering in `why`: **oldest → newest follows the `supersedes` graph**, with the identifier as the deterministic tie-break between *unrelated* records only. Depends on: T033
- [ ] T035 [US2] Mark superseded records in output with the ID that replaced them; say plainly when there is no record; report unparseable records inline. Depends on: T034
- [ ] T036 [US2] Add `--json` output for `why` per the contracts/cli.md stability guarantee. Depends on: T035

### US2 tests

- [ ] T037 [P] [US2] Test (plan #8): chain ordering follows `supersedes` with IDs **deliberately minted out of clock order** — the monotonic ULID orders within one process only. Depends on: T034
- [ ] T038 [P] [US2] Test: `why` follows git rename history (FR-038) for a file that moved. Depends on: T033
- [ ] T039 [P] [US2] Test: a file with no records produces a plain "no records" answer, not an inferred rationale. Depends on: T035
- [ ] T040 [US2] **Backfill** the June/July/September history into records, and run the evaluation set. Commit message must state the backfill did not read `evaluation/questions.md`. Report SC-002/SC-002a/SC-003 as *k/N* **per provenance population**, never merged; report `N=0` populations as "no data". Depends on: **T019**, T036

---

- [ ] **T041 — CHECKPOINT: MVP.** US1 + US2 complete. Capture is automatic and `enou why` answers. **Delivery is on demand only** — no agent sees knowledge unless it runs the command. Depends on: T032, T040

---

## Phase 6: User Story 3 — A module hands an agent its current truth (P3)

**Goal**: an agent starting work in a declared module is handed a bounded current-truth view, unasked.

- [ ] T042 [US3] **First dogfood record: the naming decision** (ordering constraint 4). `kind: decision`, `provenance: backfilled` — it documents a choice already made, so `contemporaneous` would misreport what it measures. `source`: the commit that added research.md §7. Content: `enouement` chosen; `eco-mcp`, `cairn`, `eco-harness` rejected with reasons; binary `enou` because the short forms were taken. Depends on: **T018**, **T019**, T020
- [ ] T043 [US3] Implement `src/knowledge/view.ts` — selection by kind priority (invariant → gotcha → convention → decision), then ULID descending, top N; grouped by kind on display; overflow line naming the `log` command. Depends on: **T018**, T010
- [ ] T044 [US3] Implement `enou view <module>` and `enou log <module>`; **neither writes a file**. Depends on: T043
- [ ] T045 [US3] Render a redacted summary as `[redacted]` with the identifier intact, keeping its place in the view (FR-027d). Depends on: T043
- [ ] T046 [US3] **Confirm `PostToolUse` supports `hookSpecificOutput.additionalContext`** before building the hook — the docs describe that field for `UserPromptSubmit`, and it is unverified for `PostToolUse` (contracts/hooks.md §3). If unsupported, stop and redesign delivery; do not ship a hook that silently injects nothing
- [ ] T047 [US3] Write the **tier-1 POSIX-sh pre-filter** as the hook `command` — no `args` field, or it becomes exec form and bypasses the shell. Depends on: T046
- [ ] T048 [US3] Implement `enou hook post-read` — tier-2 checks in fixed order: module membership, then per-session dedup, then records. Opens **no record file** on a miss. Depends on: T044, T047

### US3 tests

- [ ] T049 [P] [US3] Test (plan #12): tier-1 pre-filter exits 0 under **5 ms p95**, measured against a bare `sh -c 'exit 0'` baseline in the same run. Depends on: T047
- [ ] T050 [P] [US3] Test (plan #12a): tier-2 miss stays within *(p95 of an empty program on the same runtime, same run) + 5 ms* and opens no record file. **Relative**, so it survives a hardware change. Depends on: T048
- [ ] T051 [P] [US3] Test (plan #11): with `enou` absent from PATH, and separately with no `.knowledge/`, every agent hook and the git hook exits 0 and writes **nothing** to stdout or stderr (FR-042). Depends on: T047
- [ ] T052 [P] [US3] Test: view is byte-identical across two renders of an unchanged record set (SC-011), and across machines. Depends on: T043
- [ ] T053 [P] [US3] Test: kind priority outranks recency — an invariant from last year appears above a decision from today. Depends on: T043
- [ ] T054 [P] [US3] Test: over-budget module produces top N plus an overflow line naming the command; a module that omits nothing carries no overflow line. Depends on: T043
- [ ] T055 [US3] Test: a declared module with no records, and a path in no declared module, inject **nothing** — no placeholder, no empty section. Depends on: T048

---


- [ ] T056 Add a **"Personal install (manual)"** section to `quickstart.md`. **Do not build `enou init`** — that is spec 002. Cover:
  - **(a)** `bun link` in this repo puts `enou` on PATH at `~/.bun/bin/enou` (verified: it symlinks a `package.json` bin and runs a `.ts` entry via its shebang)
  - **(b)** adding the extension to **another** repo: `specify extension add <path-to-this-repo>/.specify/extensions/enouement --dev` — `--dev` is documented as "Install from local directory". Register through the CLI, never by hand-editing `.specify/extensions/.registry` (it carries a `manifest_hash`)
  - **(c)** the Claude Code hook in **user scope** (`~/.claude/settings.json`): it relies on the tier-1 sh pre-filter, so in any repo without `.knowledge/` it costs ~1–2 ms and does nothing, and it makes **no network calls** — safe to leave on globally
  - **(d)** creating `.knowledge/modules.yaml` by hand for that repo; nothing is covered until it is declared
  Depends on: T048

- [ ] **T057 — CHECKPOINT: personal dogfood.** US3 complete: capture is automatic *and* delivery is automatic, so an agent working in a declared module is handed knowledge without anyone running a command. This is the first point at which the tool is worth installing for yourself. Depends on: T055, T056


---

## Phase 7: User Story 4 — Knowledge captured outside spec-kit (P4)

- [ ] T058 [US4] Implement the session-end / pre-compaction capture offer — **enqueue and exit**, with a detached worker doing the capture. `SessionEnd` hooks share a ~1.5 s budget. Depends on: T041
- [ ] T059 [US4] Implement triple-guard idempotency: a state key over the transcript's `size:mtime`, an exclusive non-blocking lock, **and** an idempotency check on the write. Depends on: T058
- [ ] T060 [US4] Record an explicit decline durably so SC-007 can count it; fire nothing when no code changed. Depends on: T058
- [ ] T061 [P] [US4] Test (plan #9): `SessionEnd` and `PreCompact` firing for one session capture **at most once** — prior art hit this with a single guard and still double-wrote. Depends on: T059

---

## Phase 8: User Story 5 — Reviewers see knowledge and code drift apart (P5)

- [ ] T062 [US5] Extend `lint` with the FR-015 check: a declared module's code changed with neither a record nor a `Knowledge-None:` trailer. Depends on: T041
- [ ] T063 [US5] Extend `lint` with FR-016 (dangling path/symbol/commit), FR-018 (contradicting current records), FR-039 (un-covered record count on declaration removal). Depends on: T062
- [ ] T064 [US5] Implement `Knowledge-None:` trailer recognition, and flag a commit carrying **both** trailers as a contradiction rather than picking one. Depends on: T062
- [ ] T065 [US5] Add `.githooks/pre-commit` and `.githooks/pre-push` calling `enou lint`; document `git config core.hooksPath .githooks`. Depends on: T063
- [ ] T066 [US5] Add `.github/workflows/enouement.yml` running the identical `lint` with `--json`. Depends on: T063
- [ ] T067 [US5] CI reads `Knowledge-None:` trailers from **the PR's own commits**, not only the merged commit — a squash merge can drop a trailer from the merged trailer block. Depends on: T066

### US5 tests

- [ ] T068 [P] [US5] Test (plan #4): a `Knowledge-None:` trailer is still found after a squash merge recomposes the message. Depends on: T067
- [ ] T069 [P] [US5] Test: a flag clears when a record is added **and** when a no-knowledge statement is added; neither counts as manual dismissal. Depends on: T064
- [ ] T070 [P] [US5] Test (SC-012): every edit to an already-recorded file that is not a conforming redaction is rejected, reported as *k/N*. Depends on: T063

---

## Phase 9: Polish

- [ ] T071 [P] Re-measure `why` latency against the real store and compare with research.md §3's 153 ms at 10k
- [ ] T072 [P] Measure `git log --follow` and `--grep` cost on a repository with 10⁴–10⁵ commits (research.md §10 open risk). If git dominates, cache git output per invocation rather than indexing records
- [ ] T073 [P] Update `README.md` on `main` once the MVP lands — it currently says nothing is installable
- [ ] T074 Report all success criteria with denominators, populations separated, `N=0` as "no data"

---

## Dependency graph

```
Phase 1 Setup (T001-T004)
        │
Phase 2 Foundational (T005-T017) ──▶ T018 GATE ◀── constraint 1
        │                                │
T019 question set ◀── constraint 2       │
        │                                │
        │                    Phase 4 US1 (T020-T032)
        │                                │
        └──────────────▶ T040 backfill ──┤  (needs BOTH T019 and US2)
                                         │
                         Phase 5 US2 (T033-T040)
                                         │
                                  T041 CHECKPOINT: MVP  ◀── constraint 3
                                         │
                         Phase 6 US3 (T042-T056)
                                    T042 = constraint 4
                                         │
                            T057 CHECKPOINT: personal dogfood
                                         │
                    ┌────────────────────┴────────────────────┐
            Phase 7 US4 (T058-T061)              Phase 8 US5 (T062-T070)
                    └────────────────────┬────────────────────┘
                                 Phase 9 Polish (T071-T074)
```

US4 and US5 are independent of each other and may run in parallel after T041.

## Parallel opportunities

| Phase | Parallelisable |
|---|---|
| 2 | T006, T007 after T005; then T012–T017 all `[P]` |
| 4 | T028, T029, T030, T031 |
| 5 | T037, T038, T039 |
| 6 | T049–T054 |
| 7/8 | the two phases against each other |

## Summary

- **74 tasks**; 2 gates (T018, T019) and 2 checkpoints (T041 MVP, T057 personal dogfood)
- **US1** 13 · **US2** 8 · **US3** 15 · **US4** 4 · **US5** 9 · setup/foundation/polish 25
- **MVP = T001–T041.** Suggested first release boundary.
- All 14 mandatory tests from plan.md are mapped: #1→T028, #3→T031, #4→T068, #5→T013, #5a→T014, #6→T015, #7→T017, #8→T012/T037, #9→T061, #10→T032, #11→T051, #12→T049, #12a→T050, #13→T016
