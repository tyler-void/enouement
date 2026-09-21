<!--
SYNC IMPACT REPORT
==================
Version change: (unfilled template) → 1.0.0
Bump rationale: Initial ratification. The file was still the verbatim template with every
placeholder unfilled (noted as outstanding in docs/README.md since 2026-06-09), so there is no
prior version to be compatible with. First ratified version is 1.0.0.

Principles defined (all new — none renamed or removed):
  I.   Measure, Don't Assume (NON-NEGOTIABLE)
  II.  A Wrong Answer Is Worse Than No Answer
  III. Knowledge Lives in the Repo
  IV.  Supersede, Never Erase
  V.   Research Is Separate and Free to Fail

Sections added: Operating Constraints; Development Workflow; Governance.
Sections removed: none.

Derived from existing repo practice rather than invented:
  I   ← CONTRIBUTING.md §5 ("Measure, don't assume — our core principle") and §7; the corrected
        benchmark in docs/research/benchmark-results.md
  II  ← the 2026-07-28 removal of find_concept and run_command (52d5957) and its reasoning in
        docs/research/discovery-2026-07-28.md §6.1/§6.2
  III ← docs/vision/vision.md (CCI); specs/001-continuous-project-knowledge FR-019…FR-022
  IV  ← the 2026-09-21 practice of marking SPEC.md, vision.md and demo-plan.md superseded rather
        than deleting them; FR-007 of spec 001
  V   ← bench/ publishing that naive semantic top-k loses to scoped grep, against the project's
        own pitch (docs/research/benchmark-results.md)

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — no change needed; its "Constitution Check" is a
     per-feature placeholder ("[Gates determined based on constitution file]") that already
     accommodates these principles, and its Complexity Tracking table implements Principle I's
     justification requirement.
  ✅ .specify/templates/spec-template.md — no change needed; its mandatory, measurable Success
     Criteria section already enforces Principle I at spec time.
  ✅ .specify/templates/tasks-template.md — no change needed; no principle here adds or removes a
     task category.
  ✅ .specify/templates/checklist-template.md — no change needed; carries no constitution
     reference.
  ✅ CONTRIBUTING.md — §5 now names this file as the authority for the principles it summarises,
     so the two do not drift into two sources of truth.
  ⚠ CLAUDE.md — PENDING, deliberately not edited. It contains only the managed SPECKIT block, and
     Principle III commits us to coexisting with that block rather than writing around it. If you
     want agents to read the constitution unprompted, add outside the managed block:
     "Project principles are in .specify/memory/constitution.md — read it before proposing work."
  ✅ .specify/templates/commands/ — directory does not exist in this installation; nothing to check.

Deferred items: none. No placeholder tokens remain.
-->

# Cairn Constitution

## Core Principles

### I. Measure, Don't Assume (NON-NEGOTIABLE)

Every quantitative claim in this repository MUST be labelled **measured**, **derived**, or
**cited**, and MUST name the method that produced it. A number that cannot be reproduced from a
committed harness MUST NOT appear in a README, a pitch, or a commit message. A lever MUST be
measured before it is described as a win, and a measurement whose baselines were not asked the
same question MUST be withdrawn and marked under revision until it is corrected.

**Rationale**: This project exists because an assumption ("semantic search saves ~98% of tokens")
turned out to be false when measured here, and the correction is the most valuable thing the
benchmark has produced. The credibility of everything else rests on numbers that survive scrutiny.

### II. A Wrong Answer Is Worse Than No Answer

A tool, command, or answer that is confidently incorrect MUST be removed, not deprioritised or
documented around. When knowledge is absent, the system MUST say so plainly rather than infer,
guess, or substitute a plausible-looking result. Silent degradation is prohibited: a failure MUST
be visible at the point of use, and a fallback MUST be labelled as a fallback.

**Rationale**: Two tools were removed on 2026-07-28 for returning confident nonsense — an ignored
parameter that returned identical output for unrelated queries, and a compressor that replaced
real output with "all checks passed (no failures)". Both were worse than nothing, because they
were trusted. A memory system that invents reasons would fail the same way, more expensively.

### III. Knowledge Lives in the Repo

Project knowledge MUST be plain text, versioned in this repository alongside the code it
describes, and reviewable in an ordinary pull-request diff without special tooling. It MUST remain
readable and usable with no network, no hosted service, and no API key. No capability may be
offered that is reachable only through one vendor's agent: every capture and retrieval path MUST
have an explicit command-line equivalent, and every automated check MUST be reproducible in CI.

**Rationale**: Knowledge that lives in a chat log, a vendor's database, or a service that can be
switched off is knowledge the project does not own. Plain text in the repo is reviewable,
diffable, greppable, and survives every tool that produced it.

### IV. Supersede, Never Erase

A decision, measurement, or document that is overturned MUST be marked as superseded, dated, and
linked to whatever replaced it. It MUST NOT be deleted or silently rewritten. Corrections are made
by adding a newer record, not by editing the older one. Redactions of sensitive detail are the one
exception and MUST state that a redaction occurred.

**Rationale**: The reason a thing was done, and later undone, is the most expensive knowledge in a
codebase and the first to be thrown away. Deleting it destroys the trail that lets a future
reader — human or agent — understand why the current state is the way it is, and invites the same
mistake a second time.

### V. Research Is Separate and Free to Fail

Measurement and experimentation MUST live in `bench/`, separate from the shipped product, and MUST
be free to publish findings that contradict the product's own premise. An experiment MUST claim no
result until it has been run; an unmeasured experiment MUST say so. Research code MUST NOT become
a shipped dependency without its own decision record explaining the promotion.

**Rationale**: A benchmark that can only confirm the pitch is not a benchmark. Keeping research
structurally separate is what let this project publish that its headline retrieval lever lost to
scoped grep — and then narrow its own scope in response, which is the finding paying off.

## Operating Constraints

- The product MUST run offline. No network call, hosted service, or API key may be required for
  any shipped capability. Anything that sends repository content off the machine MUST be opt-in
  per workspace, never enabled by a globally-present credential.
- The product MUST coexist with spec-kit's managed context-file block and with the git extension's
  auto-commit hooks, without corrupting either or depending on either being enabled.
- Degradation to a plain CLI plus CI checks MUST be a supported configuration, not a fallback that
  is never exercised. Success criteria MUST be measured in that configuration as well.
- Dependencies MUST be justified in a decision record. Vendoring a tool the project does not call
  at runtime is prohibited — 1.3 GB of unused submodules was removed on 2026-09-21 for this
  reason.
- Secrets MUST NOT be committed. Credentials belong in a gitignored `.env`; no key may appear in
  code, docs, commit messages, or test fixtures.

## Development Workflow

- Work branches off `main` and returns through a focused pull request. PRs SHOULD be small enough
  that a reviewer can hold the whole change in their head.
- Commits use a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
  AI-assisted commits keep their `Co-Authored-By:` trailer.
- One logical change per commit, so that any single step can be reverted on its own.
- A change that removes a capability MUST state why in the commit message, and MUST leave a record
  that survives the removal (Principle IV).
- Tests that assert a removed capability stays removed are preferred over comments saying so:
  `test/client.ts` asserts the exact tool list for this reason.
- A pull request MUST NOT be merged while it leaves a documented claim contradicting a measured
  result, or knowledge contradicting the code in the same diff.
- Pre-existing failures MUST be reported as pre-existing, with evidence, rather than quietly
  inherited or quietly fixed inside an unrelated change.

## Governance

This constitution supersedes other practice documents where they conflict. `CONTRIBUTING.md`
summarises day-to-day working agreements for collaborators; where its wording differs from this
file, this file governs.

**Amendment procedure**: Amendments are proposed in a pull request that changes this file, states
the version bump and its rationale, and updates the Sync Impact Report at the top. An amendment
that weakens or removes a principle MUST record what replaced it, per Principle IV. Amendments
take effect when merged.

**Versioning policy**: This document is versioned `MAJOR.MINOR.PATCH`.
- **MAJOR** — a principle is removed or redefined in a way that would invalidate prior compliance.
- **MINOR** — a principle or section is added, or its guidance materially expanded.
- **PATCH** — clarification, wording, or typographical change that does not alter obligations.

**Compliance review**: Every pull request is reviewed against these principles. A justified
violation MUST be recorded in the plan's Complexity Tracking table, naming the simpler alternative
that was rejected and why — an unjustified violation blocks the merge. Principle I and Principle
II admit no exception: an unverifiable number and a confidently wrong answer are never justified.

**Version**: 1.0.0 | **Ratified**: 2026-09-21 | **Last Amended**: 2026-09-21
