# Specification Quality Checklist: Continuous Project Knowledge

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validation run 1** — one failure: two `[NEEDS CLARIFICATION]` markers (FR-024 module boundary,
FR-025 summary derivation). Both were genuine forks with no defensible default, so they were put
to the author rather than guessed.

**Validation run 2** — all items pass. Both markers resolved by the author:

- **Modules are explicitly declared** in a single list; paths outside it are knowingly uncovered.
  Replaced the marker with FR-024/025/026, where FR-026 (ask which tracked paths belong to no
  declared module) exists so that deliberate non-coverage cannot quietly become accidental
  non-coverage.
- **The current-truth summary is derived** from the module's decision records, never separately
  authored. Replaced the marker with FR-027/028, and recorded the consequence in Assumptions:
  this changes what `update_context` means today, since authored `domain_logic.md` prose stops
  being the source of truth.

Knock-on edits made for consistency rather than left to `/speckit-clarify`: three acceptance
scenarios and SC-005 now say *declared* module; three edge cases added (code outside any
declaration, a declaration removed while decisions still point beneath it, every decision
superseded with no replacement).

**Deliberate deferrals** — these are not gaps:

- **Targets**, per the request. SC-001…SC-010 carry provisional numbers (20 questions, 80% link
  accuracy, 50% of the `git log` + `grep` token baseline) and are flagged as provisional above the
  list. They are measurable as written; the numbers are expected to move in `/speckit-clarify`.
- **Story priority differs from the request's numbering.** Capture-outside-spec-kit (request story
  5) is P4 and PR flags (request story 4) is P5, because a coverage gap loses knowledge for good
  while a late flag only delays a fix. Each story is labelled with its original number.

**Clarification session 2026-09-21** — five clarifications supplied directly by the author and
encoded into the spec (see `## Clarifications` in spec.md). One resolved a genuine internal
contradiction this checklist had missed: FR-005 forbade creating a record for an
inconsequential change while FR-015 flagged any module changed without one, so a routine change
raised a flag that could never clear. FR-030's recorded no-knowledge statement closes it. The
spec grew from 28 to 33 requirements (FR-001a, FR-029…FR-032) and from 10 to 11 success criteria
(SC-011, determinism), and "Decision" was broadened to "Knowledge record" throughout.

Numeric targets were deliberately *not* set: the session fixed the reporting rules — every
percentage carries its denominator N — rather than the thresholds, which remain provisional.

**Clarification session 2 (2026-09-21)** — five questions asked, five answered, all five
overriding the recommendation. Closed three gaps this checklist had passed clean: the size budget
FR-013 required but never defined, the conflict between FR-007's immutability and the
constitution's redaction exception, and the undefined term "the full log" that three requirements
leaned on. Spec grew 33 → 47 requirements.

**Amendment from planning (2026-09-21)** — FR-036 amended to admit a third provenance, `oral`,
with FR-036a and SC-002a defining how the three populations are measured. Raised by the data model
during `/speckit-plan` rather than by this checklist: a spec can be internally consistent and still
be missing a case the design surfaces. Recorded in both documents rather than absorbed silently.

**Resolved by documented default, not by asking** (max 3 markers were allowed; these did not earn
a slot): what qualifies as a decision worth recording, review-before-landing, advisory vs blocking
flags in v1, how supersession is established, and retention of superseded records. All appear in
Assumptions.

**Clarification session 3 (2026-10-31)** — eight answers. Three were decided by the owner: the
audience (solo developers and small teams), an inbox-and-accept gate replacing the PR diff as the
only review, and `brief` now with `recall` gated on measurement. The other five are design
consequences of those three, proposed during the amendment and open to the owner's review: drafts
never clearing a flag or superseding a record, the implementing commit following a draft into the
record store, file-anchored symbols with a literal definition search, `brief` as the form of
FR-011, and the shape of the `recall` bar. No `[NEEDS CLARIFICATION]` marker was introduced.
Functional requirements grew 49 → 59. Every item above was re-checked against the amended spec and
still passes; the one Assumption whose reasoning changed — review-before-landing — is amended in
place with the date and the reason, not rewritten.
