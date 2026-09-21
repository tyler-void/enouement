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
| 2 | Blind protocol before backfill | backfill (**T040a**, **T042**) depends on **T019a** (hash committed, questions absent from the tree); **T019c** verifies ancestry mechanically |
| 3 | MVP = foundation → US1 → US2 | Phase 5 depends on Phase 4; checkpoints are tasks (**T041**, **T057**) |
| 4 | First dogfood record is the naming decision, after foundation | **T042** depends on T018 and is blocked from Phase 2 |

---

## Phase 0: Empirical probe — run first, depends on nothing

- [x] **T000 — DONE 2026-09-21: it surfaces** (Claude Code 2.1.270; research.md §10). Probe whether `PostToolUse` actually surfaces `additionalContext`. Docs are not
  behaviour: the hooks documentation describes `hookSpecificOutput.additionalContext` for
  `UserPromptSubmit`, it could not be confirmed as documented for `PostToolUse`, and
  anthropics/claude-code#24788 reports it not surfacing (citing #18427 for all tools). Record
  `claude --version`. In a **throwaway repo, not this one**, add a `.claude/settings.local.json`
  `PostToolUse` hook with matcher `Read` whose command prints a `hookSpecificOutput` carrying a
  nonce codeword. Read a file, then ask for the codeword; also grep that session's transcript
  JSONL for the nonce. Outcome is exactly one of **surfaces / does not surface / transcript-only**,
  recorded in research.md with the version. **If it does not surface: stop and report — do not
  pick a fallback design.** Depends on: nothing

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


**A commit-message attestation is not a protocol.** Saying "this backfill did not read the
questions" is unenforceable: if the file is in the tree, any session that touched it — or carries
it in project memory — has already read it, and cannot unread it. The blindness has to be
structural, so the questions are **not in the repository** while the backfill happens. Only their
hash is.

- [ ] **T019a — Commit the hash commitment.** The repository owner writes the evaluation questions
  and their known answers **outside this repository and outside any Claude session**, then commits
  **only** `specs/001-continuous-project-knowledge/evaluation/questions.sha256` (the sha256 of
  `questions.md`) and the question count N. `questions.md` itself is **not** committed yet and is
  not present in the working tree. **This commit must precede every backfill commit.** Depends on:
  nothing — it must be possible to do this first
  > **No agent drafts these questions.** If the questions are drafted inside a session that later
  > performs or supervises the backfill, the protocol is void before it starts.
- [ ] **T019b — Reveal, after the last backfill commit.** Commit `questions.md` itself. Depends
  on: T040a, T042
- [ ] T019c Test the protocol rather than trusting it: `sha256(questions.md)` equals the committed
  hash, the question count equals N, **and** the T019a hash commit is an ancestor of every
  backfill commit — `git merge-base --is-ancestor <hash-commit> <backfill-commit>` for each.
  A failure here voids SC-002/SC-002a/SC-003 and says so. Depends on: T019b

---

## Phase 4: User Story 1 — Decisions are recorded when a feature is finished (P1)

**Goal**: finishing a spec-kit feature produces knowledge records, unasked, linked to spec and commits.
**Independent test**: complete a spec-kit feature; inspect the PR diff; records exist with kind, one-line summary, rejected alternatives for decisions, no explicit request made.

- [ ] T020 [US1] Implement `enou record` in `src/cli/main.ts` — flags per contracts/cli.md; refuses rather than repairs; writes nothing on refusal. Depends on: **T018**
- [ ] T021 [US1] Wire capture-time secret scanning into `record`: refuse on match, report which pattern matched and in which field. Depends on: T020, T007
- [ ] T022 [US1] Implement derived implementing-commit resolution in `src/knowledge/why.ts` — `git log --diff-filter=A -- .knowledge/records/<id>.md` via `platform.ts`. Depends on: **T018**
- [ ] T023 [US1] Implement `enou modules list|uncovered` (FR-026). Depends on: **T018**, T010
- [ ] T024 [US1] Implement `enou redact` — explicit only, requires `--reason`, writes `{date, reason, fields}`, prints that the original survives in git history and that a credential must be rotated. Depends on: **T018**
- [ ] T025 [US1] Create the spec-kit extension at `.specify/extensions/enouement/` with `extension.yml` (**id `enouement`**) declaring `provides.commands` as **markdown command files** — verified from the installed git extension, whose `extension.yml` provides `commands/speckit.git.commit.md`. Spec-kit hooks invoke an **agent command**, not a shell command, so a hook cannot call `enou record` directly
- [ ] T025a [US1] **Write `commands/speckit.enouement.capture.md` — the capture prompt.** It instructs the agent to extract every decision, invariant, gotcha and convention from the finished feature and call `enou record` once per item, supplying kind, a one-line summary, affected paths, and rejected alternatives for decisions — or, when nothing of consequence was learned, to add a `Knowledge-None:` trailer instead (FR-005, FR-030). **Acceptance check**: run it against a finished feature in this repository and judge the records it produces — are they things a reader would want in a year, or restatements of the diff? A record that only says what the diff says is a failure of this task, not of the tool. Depends on: T025, T020
- [ ] T025b [US1] Write `commands/speckit.enouement.recall.md` for `before_specify`/`before_plan` — runs `enou why` over the feature's paths and presents existing records before the spec is written (FR-011). Depends on: T025, T033
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
- [ ] T040a [US2] **Blind backfill.** Record the June/July/September history as knowledge records with `provenance: backfilled`. The questions are not in the tree at this point (T019a), so this is blind by construction rather than by promise. Depends on: **T019a**, T036
- [ ] T040b [US2] **Reveal and evaluate.** After T019b, run the evaluation set and report SC-002/SC-002a/SC-003 as *k/N* **per provenance population**, never merged; `N=0` populations as "no data"; raw counts where N is too small for a percentage. Depends on: T019b, T019c

---

- [ ] **T041 — CHECKPOINT: MVP.** US1 + US2 complete. Capture is automatic and `enou why` answers. **Delivery is on demand only** — no agent sees knowledge unless it runs the command. Depends on: T032, T040a

---

## Phase 6: User Story 3 — A module hands an agent its current truth (P3)

**Goal**: an agent starting work in a declared module is handed a bounded current-truth view, unasked.

- [ ] T042 [US3] **First dogfood record: the naming decision** (ordering constraint 4). `kind: decision`, `provenance: backfilled` — it documents a choice already made, so `contemporaneous` would misreport what it measures. `source`: the commit that added research.md §7. Content: `enouement` chosen; `eco-mcp`, `cairn`, `eco-harness` rejected with reasons; binary `enou` because the short forms were taken. Depends on: **T018**, **T019a**, T020
- [ ] T043 [US3] Implement `src/knowledge/view.ts` — **current records only: superseded records are excluded entirely** (the view is current truth, not history; `enou log` is where history lives). Selection by kind priority (invariant → gotcha → convention → decision), then ULID descending, top N; grouped by kind on display; overflow line naming the `log` command. Redacted records are **not** excluded — they stay in place rendered as `[redacted]` (T045). Depends on: **T018**, T010
- [ ] T044 [US3] Implement `enou view <module>` and `enou log <module>`; **neither writes a file**. Depends on: T043
- [ ] T045 [US3] Render a redacted summary as `[redacted]` with the identifier intact, keeping its place in the view (FR-027d). Depends on: T043
- [ ] T046 [US3] Gate: T000 returned **"surfaces"** on 2.1.270, so this phase may proceed. **Re-run the probe before building the hook** — the behaviour is undocumented for `PostToolUse` and can change without a changelog entry. If a re-run returns "does not" or "transcript-only", stop; the delivery mechanism needs redesigning and that is not a task to improvise. Depends on: T000
- [ ] T047 [US3] Write the **tier-1 POSIX-sh pre-filter** as the hook `command` — no `args` field, or it becomes exec form and bypasses the shell. Depends on: T046
- [ ] T048 [US3] Implement `enou hook post-read` — tier-2 checks in fixed order: module membership, then per-session dedup, then records. Opens **no record file** on a miss. Dedup is a **marker file outside the repository** at `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enou/<session_id>/<module-id>`, keyed by the `session_id` from the hook's stdin JSON, and **claimed by exclusive create (`O_EXCL`/`"wx"`)** — the create is the lock, because Claude Code issues parallel Reads and a check-then-write would let both inject. In-memory state is impossible here: every hook invocation is a fresh process. Depends on: T044, T047
- [ ] T048a [US3] Add a `SessionStart` hook matching source **`compact`** that clears that session's marker directory. Without it the injected view is dropped by compaction while the marker survives, and the module goes silent for the rest of a long session. Depends on: T048

### US3 tests

- [ ] T049 [P] [US3] Test (plan #12): tier-1 pre-filter exits 0 under **5 ms p95**, measured against a bare `sh -c 'exit 0'` baseline in the same run. Depends on: T047
- [ ] T050 [P] [US3] Test (plan #12a): tier-2 miss stays within *(p95 of an empty program on the same runtime, same run) + 5 ms* and opens no record file. **Relative**, so it survives a hardware change. Depends on: T048
- [ ] T051 [P] [US3] Test (plan #11): with `enou` absent from PATH, and separately with no `.knowledge/`, every agent hook and the git hook exits 0 and writes **nothing** to stdout or stderr (FR-042). Depends on: T047
- [ ] T052 [P] [US3] Test: view is byte-identical across two renders of an unchanged record set (SC-011), and across machines. Depends on: T043
- [ ] T053 [P] [US3] Test: kind priority outranks recency — an invariant from last year appears above a decision from today. Depends on: T043
- [ ] T053a [P] [US3] Test: a **superseded invariant does not appear in the view** and its successor does; a **redacted** record does appear, rendered `[redacted]`. Superseded and redacted are different states and must not be conflated. Depends on: T043, T045
- [ ] T054 [P] [US3] Test: over-budget module produces top N plus an overflow line naming the command; a module that omits nothing carries no overflow line. Depends on: T043
- [ ] T055 [US3] Test: a declared module with no records, and a path in no declared module, inject **nothing** — no placeholder, no empty section. Depends on: T048
- [ ] T055a [P] [US3] Test: **two concurrent invocations for the same session and module — exactly one injects.** Run them genuinely in parallel; a sequential test would pass against a check-then-write implementation that races in practice. Depends on: T048
- [ ] T055b [P] [US3] Test: after a compact reset, the next read of that module **re-injects**. Depends on: T048a
- [ ] T055c [P] [US3] Test: the marker path is **never inside the repository** — assert the resolved path is outside the working tree for each of `XDG_RUNTIME_DIR` set, unset with `TMPDIR` set, and both unset. Depends on: T048

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
T019a hash commit ◀── constraint 2       │
        │                                │
        │                    Phase 4 US1 (T020-T032)
        │                                │
        └──────────────▶ T040a blind backfill ─┤  (needs T019a + US2)
                                         │
                         Phase 5 US2 (T033-T040b)
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

- **85 tasks**; 1 pre-flight probe (**T000**), 2 gates (T018 foundation, T019a hash commitment)
  and 2 checkpoints (T041 MVP, T057 personal dogfood)
- **US1** 15 · **US2** 9 · **US3** 20 · **US4** 4 · **US5** 9 · probe/setup/foundation/blind-protocol/polish 28
- **MVP = T001–T041.** Suggested first release boundary.
- All 14 mandatory tests from plan.md are mapped: #1→T028, #3→T031, #4→T068, #5→T013, #5a→T014,
  #6→T015, #7→T017, #8→T012/T037, #9→T061, #10→T032, #11→T051, #12→T049, #12a→T050, #13→T016
- Added by review: T025a (capture prompt + acceptance check), T053a (superseded excluded from the
  view), T055a/b/c (dedup race, compact reset, marker outside the tree), T019a/b/c (hash
  commitment, reveal, ancestry check), T040a/b (blind backfill split from evaluation), T048a
  (compact reset hook), T000 (additionalContext probe)
