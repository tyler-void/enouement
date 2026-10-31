# Tasks: Continuous Project Knowledge

**Feature**: `001-continuous-project-knowledge` | **Plan**: [plan.md](plan.md) | **Spec**: [spec.md](spec.md)
**Generated**: 2026-09-21 · **Amended**: 2026-10-31 (drafts and acceptance, symbols, `brief`,
one command definition, read-hook fixes, measured recall — spec.md, Session 2026-10-31) ·
**Nothing in this file has been implemented.** Tasks added by the amendment carry a letter suffix
so that no existing task number changes meaning.

Tests are included because plan.md lists 23 of them as mandatory (14 original + 9 added 2026-10-31), each tied to a failure that is
silent without it.

## Ordering constraints, as dependencies

The five constraints in plan.md are enforced here by the `Depends on:` field of individual tasks,
not by the order they happen to be written in. Prose ordering is advice; a dependency is a gate.

| # | Constraint | Enforced by |
|---|---|---|
| 1 | Foundation before any writer | every task that can write a record depends on **T018** (foundation gate) |
| 2 | Blind protocol before backfill | backfill (**T040a**, **T042**) depends on **T019a** (hash committed, questions absent from the tree); **T019c** verifies ancestry mechanically |
| 3 | MVP = foundation → US1 → US2 | Phase 5 depends on Phase 4; checkpoints are tasks (**T041**, **T057**) |
| 4 | First dogfood record is the naming decision, after foundation | **T042** depends on T018 and is blocked from Phase 2 |
| 5 | Acceptance lands with the first writer; trust predicate, then record + accept, before any read path | **T020a** depends on T020; the read paths T033 and T043 depend on **T009a** and **T020a**, and every later read path (T044b, T048) depends on one of them |

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
- [ ] T004 [P] Create `.knowledge/records/.gitkeep`, **`.knowledge/inbox/.gitkeep`**, and `.knowledge/modules.yaml` declaring this repo's own modules, with `defaults.view` limits; add `.knowledge/** text eol=lf` to `.gitattributes` (data-model §2.8 rule 7)
- [ ] T004a [P] Implement `src/cli/commands.ts` — **one declaration per command** (name, args, types, enums, ranges, repeatable) from which the CLI flag parser and the MCP input schema are both produced; unknown arguments are an error on both surfaces (contracts/cli.md, One definition per command). Plain data: the MCP layer translates it into its existing schema library, so no new dependency
- [ ] T004b [P] Implement `src/cli/root.ts` — repository root discovery: `ENOU_ROOT`, else nearest ancestor with `.knowledge/`, else git top level; path arguments relative to the current directory, expressed repository-relative
- [ ] T004c Wire exit codes in `src/cli/main.ts`: 0 / 1 refused / 2 lint findings / **3 internal error**, with every command catching its own failures; stack traces only under `ENOU_DEBUG`. Depends on: T004a

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
- [ ] T008a Extend `record.ts`: normalise `paths` and the path part of `symbols` (refuse, never repair); validate `symbols` as `<path>#<name>`; **re-parse the serialised bytes and require field-for-field equality before anything is put in place**; write via temp file + rename; LF, no BOM; every refusal as `{field, message}` (data-model §2.8 rules 5–7, §3 rules 14–15). Depends on: T008
- [ ] T009 Implement `src/knowledge/store.ts` — flat stores over `.knowledge/records/<ULID>.md` **and `.knowledge/inbox/<ULID>.md`**; list, read, write a draft. **Never mutates a record.** Reads the store once per command and hands the in-memory set down. Depends on: T008a
- [ ] T009a Implement `src/knowledge/trust.ts` — **the one predicate** for "counts as knowledge": in `records/`, parses, validates. Supersession is computed from records only, never drafts. Every read path and the supersession computation call this and nothing else (data-model §2.2). Depends on: T009
- [ ] T010 Implement `src/knowledge/modules.ts` — declarations, `formerly` globs, per-module `view` overrides, total order-independent resolution (current `path` beats another module's `formerly`; ties by declaration order). Depends on: T005
- [ ] T011 Implement `src/knowledge/lint.ts` round-trip + immutability checks only: parse → re-serialise byte-identical, and an existing record file changed by anything other than a conforming redaction; plus **the same ULID present in both `inbox/` and `records/`** (data-model §1). Reads the store once — linear, never a per-file re-read. Depends on: T008, T009

### Foundational tests (mandatory)

- [ ] T012 [P] Test (plan #8): ULID lexicographic sort equals chronological; monotonic within one millisecond; **and ordering across deliberately skewed clocks is NOT relied on** in `test/id.test.ts`. Depends on: T006
- [ ] T013 [P] Test (plan #5): canonical writer double-quotes every string scalar; `parse → re-serialise` byte-identical in `test/record.test.ts`. Depends on: T008
- [ ] T014 [P] Test (plan #5a): **SHA fixtures.** All-digit `0123456` must round-trip as a string (unquoted it becomes `123456`); exponent-form `6e40653` and `9e99999` must round-trip (unquoted they become `Infinity`, serialising back as `null`); `1e10` and `0e12345` must round-trip. 5.59% of 7-char SHAs are affected. In `test/record.test.ts`. Depends on: T008
- [ ] T015 [P] Test (plan #6): type validation rejects a numeric `commits` entry and a non-`YYYY-MM-DD` `date`; never coerces. Depends on: T008
- [ ] T016 [P] Test (plan #13): **no file outside `src/knowledge/platform.ts` references a `Bun.*` global** — a source scan, not a review convention, in `test/platform-seam.test.ts`. Depends on: T005
- [ ] T017 [P] Test (plan #7): a record that fails to parse fails `lint` and is **reported**, never silently skipped. Depends on: T011
- [ ] T017a [P] Test: a value that validates as an object but serialises to unparseable bytes (a lone UTF-16 surrogate in a summary) is refused **before** any file is written; a path with `..`, an absolute path and a malformed symbol are refused with `{field, message}`. Depends on: T008a
- [ ] T017b [P] Test: `trust.ts` is the only module that decides knowledge — a draft beside every record is invisible to it, and a draft naming a record in `supersedes` leaves that record current. Depends on: T009a

- [ ] **T018 — GATE: foundation complete.** All of T005–T017b pass. **No task numbered above T018 that writes a record or a draft may begin until this gate is closed.** Depends on: T004a, T004b, T004c, T005, T006, T007, T008, T008a, T009, T009a, T010, T011, T012, T013, T014, T015, T016, T017, T017a, T017b

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
  backfill commit — `git merge-base --is-ancestor <hash-commit> <backfill-commit>` for each,
  **and** every backfilled record accepted before the reveal has the same bytes as its draft at
  the commit that first added it (accepted unedited — spec.md, Success Criteria, 2026-10-31).
  A failure here voids SC-002/SC-002a/SC-003 and says so. Depends on: T019b

---

## Phase 4: User Story 1 — Decisions are recorded when a feature is finished (P1)

**Goal**: finishing a spec-kit feature produces drafts, unasked, linked to the spec; accepted, they become records whose implementing commit is derived.
**Independent test**: complete a spec-kit feature; inspect the PR diff; drafts exist with kind, one-line summary, rejected alternatives for decisions, no explicit request made; `enou accept` turns them into records.

- [ ] T020 [US1] Implement `enou record` — flags per contracts/cli.md; **writes a draft to `.knowledge/inbox/`, never a record**; returns the id; refuses rather than repairs; writes nothing on refusal. Depends on: **T018**
- [ ] T020a [US1] Implement `src/knowledge/accept.ts` and `enou drafts` / `enou accept` / `enou reject` — accept re-validates (including the secret scan and the no-fork rule of FR-046a), writes the record canonically, removes the draft; ids processed in order, output says exactly which became records; reject deletes drafts only (FR-044, FR-046). Depends on: T020, T021
- [ ] T021 [US1] Wire capture-time secret scanning into `record`: refuse on match, report which pattern matched and in which field. Depends on: T020, T007
- [ ] T022 [US1] Implement derived implementing-commit resolution in `src/knowledge/why.ts` — the **oldest** commit from `git log --diff-filter=A -- .knowledge/records/<id>.md .knowledge/inbox/<id>.md` via `platform.ts` (data-model §2.7). Depends on: **T018**
- [ ] T023 [US1] Implement `enou modules list|uncovered` (FR-026). Depends on: **T018**, T010
- [ ] T024 [US1] Implement `enou redact` — explicit only, requires `--reason`, writes `{date, reason, fields}`, prints that the original survives in git history and that a credential must be rotated. Depends on: **T018**
- [ ] T025 [US1] Create the spec-kit extension at `.specify/extensions/enouement/` with `extension.yml` (**id `enouement`**) declaring `provides.commands` as **markdown command files** — verified from the installed git extension, whose `extension.yml` provides `commands/speckit.git.commit.md`. Spec-kit hooks invoke an **agent command**, not a shell command, so a hook cannot call `enou record` directly
- [ ] T025a [US1] **Write `commands/speckit.enouement.capture.md` — the capture prompt.** It instructs the agent to extract every decision, invariant, gotcha and convention from the finished feature and call `enou record` once per item, supplying kind, a one-line summary, affected paths, declared symbols where one definition is the point, and rejected alternatives for decisions — or, when nothing of consequence was learned, to add a `Knowledge-None:` trailer instead (FR-005, FR-030). It ends by listing the drafts it wrote and telling the person to read them and run `enou accept`; **it never accepts** (FR-044a). **Quality check**: run it against a finished feature in this repository and judge the drafts it produces — are they things a reader would want in a year, or restatements of the diff? A draft that only says what the diff says is a failure of this task, not of the tool. Depends on: T025, T020, T020a
- [ ] T025b [US1] Write `commands/speckit.enouement.brief.md` for `before_specify`/`before_plan` — in the MVP it runs `enou why` over each path the feature is expected to touch and presents the records before the spec is written (FR-011); T025c upgrades it to `enou brief`. *Renamed from `recall` on 2026-10-31 (contracts/hooks.md §2).* Depends on: T025, T033
- [ ] T026 [US1] Order `after_implement` so `enouement` runs **before** the git extension's `speckit.git.commit` in `.specify/extensions.yml`. Depends on: T025
- [ ] T027 [US1] Implement `enou recall` as a stub that **exits 1 with "not implemented"** and returns no results. Depends on: **T018**

### US1 tests

- [ ] T028 [P] [US1] Test (plan #1): `recall` refuses and returns nothing. Depends on: T027
- [ ] T029 [P] [US1] Test: `record` refuses on missing/over-long summary, on `--kind decision` without `--rejected`, on unknown `--supersedes`, and on missing `--source` for `backfilled`/`oral` — writing nothing each time. Depends on: T020
- [ ] T030 [P] [US1] Test: a seeded corpus of known secret shapes is refused at capture, with the match reported (plan test 5 of SC-012). Depends on: T021
- [ ] T031 [P] [US1] Test (plan #3): the implementing commit resolves after a **squash**, a **rebase** and an **amend** — a stored SHA would not survive these. Depends on: T022
- [ ] T032 [US1] Test (plan #10): `after_implement` capture runs before the git auto-commit; inverted, every `Knowledge-Record:` trailer points one commit late. Depends on: T026
- [ ] T032a [P] [US1] Test (plan #15): a secret pasted into a draft **after** capture is refused at `accept` with the match reported, and `records/` is unchanged. Depends on: T020a
- [ ] T032b [P] [US1] Test (plan #16): the implementing commit is the **capture** commit when the draft was committed and accepted later — also after squash, rebase and amend — and the **acceptance** commit when the draft was never committed. Depends on: T022, T020a
- [ ] T032c [P] [US1] Test: accepting a draft that supersedes a record already superseded by another accepted record is refused, naming the newer record (FR-046a); `reject` never touches `records/`. Depends on: T020a

---

## Phase 5: User Story 2 — Asking why the code is like this (P2)

**Goal**: ask why a file or symbol is as it is; get the records that shaped it, oldest to newest, superseded ones marked.
**Independent test**: ask about a file with known history; compare against the known answer.

- [ ] T033 [US2] Implement `enou why <path-or-symbol>` — assemble from `paths`, git rename history (`--follow`), and `Knowledge-Record:` trailers; every id resolved through `trust.ts`, so a trailer naming a draft contributes nothing; drafts only with `--include-drafts`, labelled; an argument that is or ever was a tracked path is a path question (contracts/cli.md). Depends on: **T018**, T009a, T020a, T022
- [ ] T033a [US2] Implement `src/knowledge/symbols.ts` and wire it into `why` — declared `symbols` first; otherwise a literal `git grep` definition search at `HEAD` with whole-word exact names and fixed per-language patterns (TypeScript/JavaScript in v1); one file → its records, several → candidates and **no** records, none → said plainly (FR-047). No index. Depends on: T033
- [ ] T034 [US2] Implement supersession-chain ordering in `why`: **oldest → newest follows the `supersedes` graph**, with the identifier as the deterministic tie-break between *unrelated* records only. Depends on: T033
- [ ] T035 [US2] Mark superseded records in output with the ID that replaced them; say plainly when there is no record; report unparseable records inline. Depends on: T034
- [ ] T036 [US2] Add `--json` output for `why` per the contracts/cli.md stability guarantee. Depends on: T035

### US2 tests

- [ ] T037 [P] [US2] Test (plan #8): chain ordering follows `supersedes` with IDs **deliberately minted out of clock order** — the monotonic ULID orders within one process only. Depends on: T034
- [ ] T038 [P] [US2] Test: `why` follows git rename history (FR-038) for a file that moved. Depends on: T033
- [ ] T039 [P] [US2] Test: a file with no records produces a plain "no records" answer, not an inferred rationale. Depends on: T035
- [ ] T039a [P] [US2] Test (plan #19): a name defined in two files lists both with **zero** records; a declared symbol returns its record without searching; a nested member the patterns cannot see is "no definition found", never another file's records. Depends on: T033a
- [ ] T039b [P] [US2] Test (plan #14, `why` part): with a draft seeded beside every record, `why` never returns a draft without `--include-drafts`, a superseding draft does not mark its target superseded, and a `Knowledge-Record:` trailer naming a draft contributes nothing. Depends on: T033
- [ ] T039c [US2] **Measure** the literal definition search with a committed harness on a public repository of 10⁴–10⁵ tracked files, p50/p95 per symbol, labelled measured with its method in research.md §11 (Principle I). Depends on: T033a
- [ ] T040a [US2] **Blind backfill.** Capture the June/July/September history as drafts with `provenance: backfilled`, and accept or reject each **unedited** — the person accepting wrote the questions, so an edit before the reveal would leak them (spec.md, Success Criteria). The questions are not in the tree at this point (T019a), so this is blind by construction rather than by promise. Depends on: **T019a**, T036, T020a
- [ ] T040b [US2] **Reveal and evaluate.** After T019b, run the evaluation set and report SC-002/SC-002a/SC-003 as *k/N* **per provenance population**, never merged; `N=0` populations as "no data"; raw counts where N is too small for a percentage. Depends on: T019b, T019c

---

- [ ] **T041 — CHECKPOINT: MVP.** US1 + US2 complete. Capture is automatic, a person accepts, and `enou why` answers. **Delivery is on demand only** — no agent sees knowledge unless it runs the command. Depends on: T020a, T021, T025a, T032, T032a, T039c, T040a

---

## Phase 6: User Story 3 — A module hands an agent its current truth (P3)

**Goal**: an agent starting work in a declared module is handed a bounded current-truth view, unasked.

- [ ] T042 [US3] **First dogfood record: the naming decision** (ordering constraint 4). `kind: decision`, `provenance: backfilled` — it documents a choice already made, so `contemporaneous` would misreport what it measures. `source`: the commit that added research.md §7. Content: `enouement` chosen; `eco-mcp`, `cairn`, `eco-harness` rejected with reasons; binary `enou` because the short forms were taken. Written as a draft and accepted unedited (ordering constraint 5). Depends on: **T018**, **T019a**, T020, T020a
- [ ] T043 [US3] Implement `src/knowledge/view.ts` — **current records only: superseded records are excluded entirely** (the view is current truth, not history; `enou log` is where history lives). Selection by kind priority (invariant → gotcha → convention → decision), then ULID descending, top N; grouped by kind on display; overflow line naming the `log` command. Redacted records are **not** excluded — they stay in place rendered as `[redacted]` (T045). Records only, through `trust.ts`. Depends on: **T018**, T009a, T010, T020a
- [ ] T044 [US3] Implement `enou view <module>` and `enou log <module>`; **neither writes a file**. Depends on: T043
- [ ] T044a [US3] Implement `enou show <ULID>` — one record or draft with its **computed** status and derived implementing commit (contracts/cli.md). Depends on: T043, T022
- [ ] T044b [US3] Implement `src/knowledge/brief.ts` and `enou brief <path>...` — records per path (deduplicated), module views, gaps `uncovered-path`, `module-without-knowledge`, `drafts-waiting`, and a **complete `checked` list** of the checks that actually ran. `contradiction` and `dangling-reference` join the list in T063a, when US5 provides them — until then they are absent from `checked`, not reported as clean (FR-048). Depends on: T043, T033, T009a
- [ ] T044c [US3] Replace the MCP surface in `src/server.ts` with the tools of contracts/cli.md (MCP server) — `why`, `view`, `log`, `brief`, `show`, `drafts`, `record` — generated from `commands.ts`; **remove `get_context` and `update_context`**, with the commit message stating why (constitution, Development Workflow); update `test/client.ts` to assert the new list exactly (plan #17). Depends on: T044b, T044a, T020a, T004a
- [ ] T025c [US3] Upgrade `commands/speckit.enouement.brief.md` from per-path `enou why` to `enou brief`, so the author sees module views and gaps as well as records (FR-011, FR-048). Depends on: T025b, T044b
- [ ] T045 [US3] Render a redacted summary as `[redacted]` with the identifier intact, keeping its place in the view (FR-027d). Depends on: T043
- [ ] T046 [US3] Gate: T000 returned **"surfaces"** on 2.1.270, so this phase may proceed. **Re-run the probe before building the hook** — the behaviour is undocumented for `PostToolUse` and can change without a changelog entry. If a re-run returns "does not" or "transcript-only", stop; the delivery mechanism needs redesigning and that is not a task to improvise. Depends on: T000
- [ ] T047 [US3] Write the **tier-1 POSIX-sh pre-filter** as the hook `command` — no `args` field, or it becomes exec form and bypasses the shell. Depends on: T046
- [ ] T048 [US3] Implement `enou hook post-read` — tier-2 checks in fixed order: module membership, then per-session dedup, then records. Opens **no record file** on a miss. Dedup is a **marker file outside the repository** at `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enou/<session_id>/<module-id>`, keyed by the `session_id` from the hook's stdin JSON, and **claimed by exclusive create (`O_EXCL`/`"wx"`)** — the create is the lock, because Claude Code issues parallel Reads and a check-then-write would let both inject. In-memory state is impossible here: every hook invocation is a fresh process. Depends on: T044, T047
- [ ] T048a [US3] Add a `SessionStart` hook matching source **`compact`** that clears that session's marker directory. Without it the injected view is dropped by compaction while the marker survives, and the module goes silent for the rest of a long session. Depends on: T048
- [ ] T048b [US3] After the module view, inject the **file-specific** current records (exact file, then deepest directory) not already in the view or already injected — the "already injected" filter runs **before** the count limit; over-long lines are shortened with a marker, never dropped; one budget for view and lines; per-record markers; paths compared after resolving symbolic links (contracts/hooks.md §3). Depends on: T048
- [ ] T048c [P] [US3] On `SessionStart`, emit one line naming the declared modules that have knowledge, the count of drafts waiting, and the commands that show them — a fixed projection of `modules.yaml` and counts, behind the tier-1 pre-filter, empty when there is nothing to name (contracts/hooks.md §3, Coexistence; Principle II requires it at the point of use). Depends on: T048a

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
- [ ] T055d [P] [US3] Test (plan #21): with more file-specific records than `max_file_records`, the first read of the file injects the limit plus an overflow line naming **every** remaining id; nothing is shortened; a repeat read of the same file opens no record file. Depends on: T048b
- [ ] T055e [P] [US3] Test (plan #14, read-path part): with drafts seeded beside every record, `view`, `log`, the read hook and `brief` never surface a draft without `--include-drafts`. Depends on: T048b, T044b
- [ ] T055f [P] [US3] Test (plan #22): `brief` always carries a complete `checked` list; two briefs over unchanged records and paths are byte-identical; paths all outside every module give zero records, every path `uncovered-path`, and a non-empty `checked`. Depends on: T044b
- [ ] T055g [US3] Test (plan #18): the real `enou` binary and the real MCP server over stdio return identical bytes for the same input on every shared command, **including an invalid and an unknown argument**. Depends on: T044c
- [ ] T055h [P] [US3] **Measure** `brief` latency over 1, 10 and 100 paths at the design volume, with a committed harness, and record it in research.md §11 labelled measured (Principle I). Depends on: T044b

---


- [ ] T056 Add a **"Personal install (manual)"** section to `quickstart.md`. **Do not build `enou init`** — that is spec 002. Cover:
  - **(a)** `bun link` in this repo puts `enou` on PATH at `~/.bun/bin/enou` (verified: it symlinks a `package.json` bin and runs a `.ts` entry via its shebang)
  - **(b)** adding the extension to **another** repo: `specify extension add <path-to-this-repo>/.specify/extensions/enouement --dev` — `--dev` is documented as "Install from local directory". Register through the CLI, never by hand-editing `.specify/extensions/.registry` (it carries a `manifest_hash`)
  - **(c)** the Claude Code hook in **user scope** (`~/.claude/settings.json`): it relies on the tier-1 sh pre-filter, so in any repo without `.knowledge/` it costs ~1–2 ms and does nothing, and it makes **no network calls** — safe to leave on globally
  - **(d)** creating `.knowledge/modules.yaml` by hand for that repo; nothing is covered until it is declared
  - **(e)** the Claude Code permission **deny rules for `enou accept`, `enou reject` and `enou redact`**, and why they exist (FR-044a, contracts/hooks.md §3) — and the day-to-day loop: the agent captures, you run `enou drafts`, read, edit if needed, `enou accept`
  - **(f)** the coexistence note: tools that replace `Read` can stop the read hook firing; `enou brief` and `enou view` are the explicit path
  Depends on: T048, T020a

- [ ] **T057 — CHECKPOINT: personal dogfood.** US3 complete: capture is automatic *and* delivery is automatic, so an agent working in a declared module is handed knowledge without anyone running a command. This is the first point at which the tool is worth installing for yourself. Depends on: T055, T055g, T056


---

## Phase 7: User Story 4 — Knowledge captured outside spec-kit (P4)

- [ ] T058 [US4] Implement the session-end / pre-compaction capture offer — **enqueue and exit**, with a detached worker doing the capture. `SessionEnd` hooks share a ~1.5 s budget. The worker writes **drafts**, never records (FR-043); the person learns of them from the next `SessionStart` line (T048c) and from `lint` and `brief`. Depends on: T041, T048c
- [ ] T059 [US4] Implement triple-guard idempotency: a state key over the transcript's `size:mtime`, an exclusive non-blocking lock, **and** an idempotency check on the write. Depends on: T058
- [ ] T060 [US4] Record an explicit decline durably so SC-007 can count it; fire nothing when no code changed. Depends on: T058
- [ ] T061 [P] [US4] Test (plan #9): `SessionEnd` and `PreCompact` firing for one session capture **at most once** — prior art hit this with a single guard and still double-wrote. Depends on: T059

---

## Phase 8: User Story 5 — Reviewers see knowledge and code drift apart (P5)

- [ ] T062 [US5] Extend `lint` with the FR-015 check: a declared module's code changed with neither an **accepted** record nor a `Knowledge-None:` trailer; when a draft would cover it, the flag names that draft (FR-015, FR-045). Depends on: T041
- [ ] T063 [US5] Extend `lint` with FR-016 (dangling path/commit, and declared symbols whose file — followed through renames, so a rename alone is never a finding (FR-037) — is gone or no longer defines the name; FR-047), FR-018 (contradicting current records), FR-039 (un-covered record count on declaration removal), a file added under `records/` that fails capture validation, and FR-050 drafts-waiting as information that never sets exit 2. Depends on: T062, T033a
- [ ] T063a [US5] Add `contradiction` and `dangling-reference` to `brief`'s checks, reusing T063's checks rather than reimplementing them. Depends on: T063, T044b
- [ ] T064 [US5] Implement `Knowledge-None:` trailer recognition, and flag a commit carrying **both** trailers as a contradiction rather than picking one. Depends on: T062
- [ ] T065 [US5] Add `.githooks/pre-commit` and `.githooks/pre-push` calling `enou lint`; document `git config core.hooksPath .githooks`. Depends on: T063
- [ ] T066 [US5] Add `.github/workflows/enouement.yml` running the identical `lint` with `--json`. Depends on: T063
- [ ] T067 [US5] CI reads `Knowledge-None:` trailers from **the PR's own commits**, not only the merged commit — a squash merge can drop a trailer from the merged trailer block. Depends on: T066

### US5 tests

- [ ] T068 [P] [US5] Test (plan #4): a `Knowledge-None:` trailer is still found after a squash merge recomposes the message. Depends on: T067
- [ ] T069 [P] [US5] Test: a flag clears when a record is added **and** when a no-knowledge statement is added; neither counts as manual dismissal. Depends on: T064
- [ ] T070 [P] [US5] Test (SC-012): every edit to an already-recorded file that is not a conforming redaction is rejected, reported as *k/N*. Depends on: T063
- [ ] T070a [P] [US5] Test (plan #20): `lint` over 2N records takes less than three times as long as over N, measured in the same run — catches a quadratic re-read that every functional test would pass. Depends on: T063

---

## Phase 8b: Measured recall — `bench/` only until it clears its bar (FR-049)

Independent of US4/US5. **Nothing here changes the shipped `recall` stub until T078**, and T078
may never run: a bar that is not met is a result, recorded as such (Principle V).

- [ ] **T075 — Register the protocol before any ranker exists.** As with T019a, the owner writes the judged query set and its answers **outside this repository and outside any Claude session**; commit only its sha256, the query count, and `bench/recall/protocol.md` stating the thresholds for Recall@5, MRR and the no-match share (research.md §13). The set MUST include no-relevant-record queries and a word-mismatch slice. Depends on: nothing — it must be possible to do this first
- [ ] T076 Build the BM25 ranker in `bench/recall/` to research.md §13's constraints — explainable per-term contributions, meaningful fields with headings excluded from the body, abstention as a separate rule, statistics from accepted current records only, id tie-break. It MUST NOT read the question set. Depends on: T075
- [ ] T077 Freeze the ranker, reveal the question set, verify the hash and that T075 is an ancestor of every T076 commit (as T019c does), and report every measure as *k/N*, the no-match share never merged with ranking quality. Write the outcome — met or not — as a decision record. Depends on: T076
- [ ] T078 **Only if T077 met every threshold**: replace the stub with the measured ranker, keep its explanation and abstention output per contracts/cli.md, add `recall` to the MCP tool list and to `test/client.ts`, and replace T028 with tests of the shipped behaviour. Depends on: T077

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

Phase 8b Measured recall (T075-T078) — bench/ only; independent of every phase above;
         only T078 touches the product, and only if T077 met its registered bar
```

US4 and US5 are independent of each other and may run in parallel after T041, except that US4's
capture worker (T058) needs the `SessionStart` line of T048c to tell the person drafts are
waiting. Phase 8b (measured
recall) depends on nothing in the product and may start whenever T075's question set is ready;
only T078 touches the product.

## Parallel opportunities

| Phase | Parallelisable |
|---|---|
| 2 | T006, T007 after T005; then T012–T017 all `[P]` |
| 4 | T028, T029, T030, T031 |
| 5 | T037, T038, T039 |
| 6 | T049–T054 |
| 7/8 | the two phases against each other |

## Summary

- **117 tasks** (85 original + 32 added 2026-10-31); 1 pre-flight probe (**T000**), 2 gates (T018 foundation, T019a hash commitment)
  and 2 checkpoints (T041 MVP, T057 personal dogfood)
- **US1** 19 · **US2** 13 · **US3** 31 · **US4** 4 · **US5** 11 · measured recall 4 · probe/setup/foundation/blind-protocol/polish 35
- **MVP = T001–T041.** Suggested first release boundary.
- All 14 mandatory tests from plan.md are mapped: #1→T028, #3→T031, #4→T068, #5→T013, #5a→T014,
  #6→T015, #7→T017, #8→T012/T037, #9→T061, #10→T032, #11→T051, #12→T049, #12a→T050, #13→T016
- Mandatory tests added 2026-10-31: #14→T017b/T039b/T055e, #15→T032a, #16→T032b, #17→T044c,
  #18→T055g, #19→T039a, #20→T070a, #21→T055d, #22→T055f
- Added by review: T025a (capture prompt + acceptance check), T053a (superseded excluded from the
  view), T055a/b/c (dedup race, compact reset, marker outside the tree), T019a/b/c (hash
  commitment, reveal, ancestry check), T040a/b (blind backfill split from evaluation), T048a
  (compact reset hook), T000 (additionalContext probe)
- **Added by the 2026-10-31 amendment — 32 tasks**, all suffixed so existing numbers keep their
  meaning: one command definition, root discovery, exit 3 (T004a–c); path/symbol normalisation,
  byte-level validation, atomic writes (T008a); inbox store and the trust predicate (T009, T009a);
  acceptance (T020a); symbols (T033a); `show`, `brief`, the new MCP surface (T044a–c); read-hook
  fixes and coexistence (T048b–c); lint additions and `brief`'s later checks (T063, T063a);
  measured recall (T075–T078); and the tests for plan #14–#22 (T017a–b, T032a–c, T039a–b,
  T055d–g, T070a); measurements the amendment owes under Principle I (T039c, T055h); and the
  upgrade of the pre-spec prompt from `why` to `brief` (T025c). T025b is renamed.
