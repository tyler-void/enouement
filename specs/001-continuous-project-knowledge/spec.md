# Feature Specification: Continuous Project Knowledge

**Feature Branch**: `001-continuous-project-knowledge`
**Created**: 2026-09-21
**Status**: Draft
**Input**: User description: "Continuous project knowledge: repo memory that grows with the code and the team."

## Overview

A year after a change, nobody can say why the code is the way it is. The reasoning lived in a
chat session, a PR thread, or someone's head, and none of those are in the repo. Agents pay for
this twice: they re-derive conclusions that were already reached, and they contradict decisions
that were made deliberately.

This feature makes the repo remember. Decisions — including the alternatives that were
rejected — are recorded as the work happens, linked to the spec that drove them and the commits
that landed them, and surfaced again when someone (or some agent) touches the same code. The
knowledge is plain text in the repo, so it is reviewed in ordinary PR diffs and it survives
without a server, a network, or a particular agent vendor.

## User Scenarios & Testing *(mandatory)*

Stories are listed in priority order. Each names the story number from the original request, as
the priority order differs: capturing knowledge outside spec-kit is treated as more valuable
than flagging stale knowledge, because coverage gaps lose knowledge permanently while a missing
flag only delays a fix.

### User Story 1 - Decisions are recorded when a feature is finished (Priority: P1) *(request story 1)*

A developer finishes a spec-kit feature. Without being asked, the decisions made along the way —
what was chosen, why, and what was considered and rejected — are written into the repo and
linked to the spec that drove them and the commits that implemented them. Later, when a
different feature touches the same paths, those decisions are put in front of the author before
the new spec is written.

**Why this priority**: Nothing else in this feature can exist without captured decisions. It is
also the only story that delivers value on its own with no other part built: a reviewer reading
the PR sees the reasoning next to the diff, which is more than they get today.

**Independent Test**: Complete a spec-kit feature, then inspect the PR diff. The decisions are
present, each names its rejected alternatives, and each links to the spec and the commits.
Nothing had to be requested.

**Acceptance Scenarios**:

1. **Given** a spec-kit feature that changed three files and rejected one alternative approach,
   **When** the feature is completed, **Then** a decision record exists for each decision,
   stating the choice, the reasoning, and the rejected alternative, and linking to the spec and
   to the commits that landed it — with no explicit request from the developer.
2. **Given** decisions already recorded against `src/util/context.ts`, **When** a new spec-kit
   feature begins that will touch `src/util/context.ts`, **Then** those decisions are presented
   to the author before the new spec is written. *(the second time)*
3. **Given** a feature where no decision of consequence was made, **When** it is completed,
   **Then** no empty or filler record is created.
4. **Given** captured decisions, **When** the PR is opened, **Then** the knowledge changes appear
   as readable additions in the ordinary diff, not as an opaque or generated blob.

---

### User Story 2 - Asking why the code is like this (Priority: P2) *(request story 2)*

Someone asks why a file or symbol is the way it is. They get the decisions that shaped it,
oldest first, each with its spec and commit links, and decisions that have since been overturned
are shown as superseded rather than silently dropped or silently presented as current.

**Why this priority**: This is the payoff the capture exists for, and the story the success
metrics are measured against. It is second only because it needs records to read.

**Independent Test**: Ask "why is this like this?" about a file with known history and compare
the answer against the known answer — the decisions, in order, with correct links.

**Acceptance Scenarios**:

1. **Given** a file with three recorded decisions, **When** a developer asks why it is the way it
   is, **Then** all three are returned oldest to newest, each with its spec and commit links.
2. **Given** a decision that was later overturned by a newer decision, **When** the same question
   is asked, **Then** both appear, the older is marked superseded, and the record states which
   decision replaced it. *(the second time)*
3. **Given** a symbol rather than a file, **When** the question names the symbol, **Then** the
   decisions affecting the file that defines it are returned.
4. **Given** a file with no recorded decisions, **When** the question is asked, **Then** the
   answer says so plainly rather than inferring a rationale from the code.

---

### User Story 3 - A module hands an agent its current truth (Priority: P3) *(request story 3)*

An agent starts work inside a module and is given, automatically, a short summary of what is
currently true about that module — the rules that hold now, not the history of how they came to
hold. The summary stays within a size budget so it never becomes the thing that costs too much
to read.

**Why this priority**: This is the read path that makes the knowledge pay for itself in day-to-day
agent work, and it is what the token-per-answer metric is compared against. It depends on
captured knowledge existing.

**Independent Test**: Start work in a module with recorded knowledge; confirm a current-truth
summary arrives without being requested and measures within budget.

**Acceptance Scenarios**:

1. **Given** a declared module with recorded decisions, **When** an agent begins work inside it,
   **Then** a current-truth summary of that module is provided without being requested.
2. **Given** the module's knowledge has since changed, **When** an agent next begins work there,
   **Then** the summary reflects the change and is still within the size budget. *(the second
   time)*
3. **Given** a module whose accumulated knowledge exceeds the budget, **When** the summary is
   produced, **Then** it stays within budget and says that it was condensed, with a pointer to
   the full record.
4. **Given** a path belonging to no declared module, or a declared module with no recorded
   decisions, **When** an agent begins work there, **Then** nothing is injected — no placeholder,
   no empty section.

---

### User Story 4 - Knowledge is captured outside spec-kit too (Priority: P4) *(request story 5)*

A developer does work that never goes through spec-kit — a hotfix, an exploratory session, a
one-off. The knowledge from that work is still captured before the session ends or its context
is compacted, so the record does not have a hole where the urgent work was. The prompt to
capture is asked at most once per session, so it stays a help and not a nag.

**Why this priority**: This closes the largest coverage hole. Knowledge lost at the end of an
unstructured session is lost permanently, which is worse than a flag that fires late. It ranks
below the read paths only because those prove the value.

**Independent Test**: Run a session that changes code without a spec, end it, and confirm the
knowledge was captured and the reminder fired exactly once.

**Acceptance Scenarios**:

1. **Given** a session that changed code with no spec-kit feature, **When** the session is about
   to end or its context is about to be compacted, **Then** the developer is prompted to capture
   the knowledge, and on acceptance it is recorded and linked to the commits.
2. **Given** the reminder already fired once in a session, **When** the session later approaches
   another end-or-compaction point, **Then** it does not fire again. *(the second time)*
3. **Given** a session that changed no code, **When** it ends, **Then** no reminder fires.
4. **Given** the developer declines the prompt, **When** the session ends, **Then** nothing is
   written and the decline is not treated as an error.

---

### User Story 5 - Reviewers see when knowledge and code drift apart (Priority: P5) *(request story 4)*

A PR changes a module but leaves its knowledge untouched, or the knowledge points at code that
no longer exists. Either way the reviewer sees a flag on the PR saying so. Once the gap is
fixed, the flag clears on its own.

**Why this priority**: This is what stops the knowledge rotting into something nobody trusts. It
is last because it has nothing to check until the other stories are producing and consuming
records.

**Independent Test**: Open a PR that changes a module without touching its knowledge; confirm the
flag appears. Push the missing knowledge; confirm it clears.

**Acceptance Scenarios**:

1. **Given** a PR that changes a module's code but not its knowledge, **When** the PR is opened or
   updated, **Then** the reviewer sees a flag naming the module and what is missing.
2. **Given** a knowledge record that references a file or symbol that no longer exists, **When**
   the PR is checked, **Then** the reviewer sees a flag naming the dangling reference.
3. **Given** a flagged PR, **When** the knowledge is updated to close the gap and the PR is
   updated, **Then** the flag clears without anyone dismissing it by hand. *(the second time)*
4. **Given** a PR that only changes code belonging to no declared module, **When** it is checked,
   **Then** no flag is raised for the untouched-knowledge case.

---

### Edge Cases

- Two branches record knowledge for the same module and both merge. The records must combine
  without a merge conflict in the common case, and any conflict that does occur must be
  resolvable by a human reading the diff.
- A commit that a decision links to is later rebased, amended, or squashed away, leaving the link
  pointing at nothing. This is the dangling-reference case from Story 5 and must be flagged, not
  silently broken.
- A decision is superseded by a decision that is itself later superseded. The chain must stay
  readable oldest-to-newest, with only the last one current.
- Code is moved or renamed wholesale (as `src/backends/semantic.ts` was moved into `bench/`).
  Knowledge attached to the old path must not silently vanish or silently follow.
- A file is deleted along with the reason it existed. The decisions that explain its removal must
  remain findable even though the path no longer exists.
- The agent in use is not Claude Code, so no automatic hooks fire. Every capture and read path
  must remain reachable as an explicit command, and the PR flags must still be produced by CI.
- Two knowledge records disagree about current truth and neither is marked superseded. The
  contradiction must be visible rather than resolved arbitrarily by picking one.
- A module accumulates years of decisions. The history must stay complete while the current-truth
  summary stays within budget.
- New code is added in a path that belongs to no declared module. By design it raises no flags and
  gets no summary, so the coverage gap is invisible in the PR — it must remain discoverable by
  asking for uncovered paths (FR-026).
- A module declaration is removed, or its path is renamed, while decisions still reference paths
  beneath it. Those decisions must not be orphaned silently.
- Every current decision for a module is superseded and none replaces them. The derived summary
  must say the module has no current truth recorded, rather than rendering as empty.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: System MUST record a decision as a plain-text record in the repository, containing
  at minimum the decision made, the reasoning, the alternatives considered and rejected, the date,
  and the code paths affected.
- **FR-002**: System MUST link each decision record to the spec that drove it (when one exists)
  and to the commits that implemented it.
- **FR-003**: System MUST capture decisions on completion of a spec-kit feature without the
  developer explicitly requesting it.
- **FR-004**: System MUST offer to capture decisions from work done outside spec-kit before a
  session ends or its context is compacted, and MUST make that offer at most once per session.
- **FR-005**: System MUST NOT create a record when no decision of consequence was made.
- **FR-006**: Users MUST be able to record, amend, and supersede a decision explicitly, without
  waiting for an automatic trigger.
- **FR-007**: System MUST record a decision as superseding a named earlier decision, and MUST
  preserve the earlier record rather than overwriting or deleting it.

**Retrieval**

- **FR-008**: Users MUST be able to ask why a given file or symbol is the way it is and receive
  the decisions that shaped it, ordered oldest to newest.
- **FR-009**: System MUST mark superseded decisions as superseded in every answer, and MUST name
  the decision that replaced them.
- **FR-010**: System MUST state plainly when a file or symbol has no recorded decisions, rather
  than inferring a rationale from the code itself.
- **FR-011**: System MUST surface the existing decisions for the paths a new spec-kit feature will
  touch, before that feature's spec is written.
- **FR-012**: System MUST provide a module's current-truth summary to an agent beginning work in
  that module, without being asked, and MUST provide nothing when the module has no recorded
  knowledge.
- **FR-013**: System MUST keep each current-truth summary within a defined size budget, and MUST
  state when a summary has been condensed and where the full record is.
- **FR-014**: System MUST reflect subsequent knowledge changes in the current-truth summary.

**Integrity**

- **FR-015**: System MUST flag, on a pull request, any module whose code changed while its
  knowledge did not.
- **FR-016**: System MUST flag, on a pull request, any knowledge record referencing a file,
  symbol, or commit that no longer exists.
- **FR-017**: System MUST clear a flag automatically once the gap that raised it is closed, with
  no manual dismissal step.
- **FR-018**: System MUST make visible, rather than silently resolve, two current records that
  contradict each other.

**Form and environment**

- **FR-019**: All knowledge MUST be stored as plain text inside the repository, versioned with the
  code it describes.
- **FR-020**: Knowledge changes MUST be reviewable in an ordinary pull request diff, readable
  without special tooling.
- **FR-021**: System MUST work with no network access and no hosted service.
- **FR-022**: Every capture and retrieval path MUST remain available as an explicit command when
  the agent in use provides no automatic triggers, and the pull-request flags MUST be produced by
  continuous integration in that case.
- **FR-023**: System MUST coexist with spec-kit's managed context-file block and with the git
  extension's auto-commit hooks, without corrupting either or being corrupted by them.
- **FR-024**: Modules MUST be explicitly declared in a single list in the repository. A path
  belongs to a module only by virtue of that declaration.
- **FR-025**: System MUST raise no integrity flags and provide no current-truth summary for paths
  that belong to no declared module.
- **FR-026**: Users MUST be able to add, move, and remove module declarations, and MUST be able to
  ask which tracked paths belong to no declared module, so that coverage gaps are visible on
  demand rather than silent.
- **FR-027**: The current-truth summary MUST be derived from the module's decision records, and
  MUST NOT be separately authored prose that can disagree with them.
- **FR-028**: System MUST reflect a newly recorded or newly superseded decision in the derived
  summary without a separate update step.

### Key Entities

- **Decision**: One choice and its reasoning. Holds the decision, why, rejected alternatives,
  date, affected code paths, links to a spec and commits, and a status of current or superseded
  with a pointer to whichever decision replaced it. Immutable once recorded — corrections are made
  by superseding, not editing.
- **Module**: A declared unit of code that knowledge attaches to, named in the repository's module
  list. Paths outside every declared module are simply not covered.
- **Current-truth summary**: A bounded, derived view of what holds now for one module, computed
  from that module's current (non-superseded) decisions. It is a projection, not a source — it is
  never edited directly, so it cannot disagree with the records it comes from.
- **Knowledge-to-code link**: The association between a decision and the paths, symbols, specs and
  commits it concerns. This is what makes both "why is this file like this" and dangling-reference
  detection possible.
- **Capture event**: An occasion on which knowledge was recorded — a completed spec-kit feature or
  an ad-hoc session — carrying when it happened and what triggered it, so coverage gaps are
  visible.
- **Integrity flag**: An open finding on a pull request: a module changed without its knowledge,
  a reference pointing at code that is gone, or two current records in contradiction. Raised and
  cleared by the state of the repository, never dismissed by hand.

## Success Criteria *(mandatory)*

Targets below are provisional defaults to be confirmed or replaced in `/speckit-clarify`, as the
request specified. The evaluation set is this repository's own history, which contains three
well-understood turning points to backfill from: the June 2026 gateway build, the July 2026
removal of two tools that returned wrong answers, and the September 2026 narrowing to project
memory.

### Measurable Outcomes

- **SC-001**: A backfilled evaluation set of at least 20 "why" questions drawn from this
  repository's history, each with a known correct answer agreed before the system is run against
  it.
- **SC-002**: For at least 80% of those questions, the answer cites the correct spec or commit for
  the decision it describes.
- **SC-003**: For at least 90% of questions whose known answer involves a decision that was later
  overturned, the answer shows both decisions and marks the older one superseded.
- **SC-004**: Answering a "why" question costs no more than half the tokens of the `git log` +
  `grep` baseline a developer or agent would otherwise use to reconstruct the same answer.
- **SC-005**: Every declared module's current-truth summary is within its size budget, measured
  across every declared module, with zero exceptions.
- **SC-006**: A developer or agent gets a usable answer to "why is this like this?" in under 30
  seconds, without leaving the repository or consulting a person.
- **SC-007**: Of features completed through spec-kit, 100% produce decision records with no
  explicit request; of sessions that changed code outside spec-kit, at least 80% end with
  knowledge captured or an explicit, recorded decline.
- **SC-008**: Every flag raised on a pull request clears on its own once the gap is closed, with
  no manual dismissal, measured over the evaluation set.
- **SC-009**: Knowledge changes are reviewable as ordinary diffs: a reviewer with no knowledge of
  this feature can read a knowledge change in a PR and say what decision it records.
- **SC-010**: Every capture and retrieval path works with the network disabled and with an agent
  that fires no automatic hooks.

## Assumptions

- **Decisions worth recording** are those that change behaviour or an interface, or that rejected
  a considered alternative. Routine changes with no alternative worth naming are not recorded;
  FR-005 makes this explicit so the record does not fill with noise.
- **The developer reviews before it lands.** Automatic capture writes into the working tree and is
  reviewed in the PR like any other change. "Without me asking" (request story 1) is read as "not
  having to request capture", not as "committed without review".
- **Integrity flags are advisory in v1** — visible to the reviewer, not blocking the merge. A
  blocking gate is a team workflow decision that can be turned on later once flag volume is known
  to be low.
- **Supersession is stated, not inferred.** A decision is marked superseded when a new decision
  says so. The system prompts for the link when a new decision touches paths that already have
  current decisions, but does not guess.
- **Superseded decisions are kept forever.** There is no pruning in v1; history is the point, and
  the size budget applies to the current-truth summary rather than to the archive.
- **Coverage is deliberate, not automatic.** Because modules are declared (FR-024), code outside
  the list is knowingly uncovered rather than accidentally missed. FR-026 exists so that choice
  stays honest — a team can ask what is uncovered instead of discovering it years later.
- **The derived summary replaces authored module prose.** Today `update_context` writes authored
  prose to `<module>/.context/domain_logic.md`. Deriving the summary from decision records
  (FR-027) means that prose stops being the source of truth; the existing tools' behaviour changes
  with this feature rather than sitting alongside it. Migrating what is already written into
  decision records is part of the backfill in SC-001.
- **Spec-kit is present** and the git extension's auto-commit hooks may be enabled; both are
  treated as fixed constraints to coexist with, not as things this feature may change.
- **Claude Code is the reference agent** for automatic triggers. Other agents get the same
  capabilities through explicit commands and CI, per FR-022, and the success criteria are measured
  in the degraded configuration as well.
- **The evaluation set is authored from this repository's history** rather than a synthetic corpus,
  so the known answers are verifiable against real commits and docs.

## Out of Scope (v1)

- Personal memory that follows a developer across projects.
- Vector databases and embedding-based retrieval.
- Hosted or networked services of any kind.
- Jev reranking, which remains a `bench/` research experiment.
