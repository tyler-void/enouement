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

## Clarifications

### Session 2026-09-21

- Q: FR-005 forbids creating a record for a routine change, but FR-015 flags any module whose code
  changed without its knowledge — how does such a flag ever clear? → A: A flag clears when
  **either** a knowledge record covers the change **or** the change carries an explicit, recorded
  "no knowledge" statement (for example a commit trailer). That statement is what SC-007 counts as
  an "explicit, recorded decline", and it is not a manual dismissal under FR-017.
- Q: FR-027 says the current-truth view is "derived" — derived how? → A: A deterministic
  projection, never model synthesis. Every record carries a mandatory one-line summary written at
  capture time; the view is the ordered list of the current records' one-line summaries with their
  IDs, truncated by a fixed rule, with a pointer to the full log. The same records in produce a
  byte-identical view out.
- Q: Is "decision" the only kind of knowledge worth recording? → A: No. The entity is a **knowledge
  record** with a kind of decision, invariant, gotcha, or convention. All kinds are immutable and
  supersedable; FR-001's rejected-alternatives requirement applies to kind=decision only.
- Q: How are record identifiers assigned? → A: They must not collide when generated independently
  on concurrent branches. Sequential counters are prohibited.
- Q: The success criteria are percentages — of how many? → A: Every percentage must be reported
  with its denominator N. SC-003 in particular has very few qualifying questions in this
  repository's history, so its percentage is not meaningful without N beside it.
- Q: FR-013 requires the view to stay "within a defined size budget", but nothing defines it —
  how is it bounded, and which records survive? → A: Budget is a maximum record count **N** plus a
  maximum length per one-line summary, both tokenizer-free. Selection is by **kind priority**
  (invariant > gotcha > convention > decision), then newest first by identifier, keeping the top
  N; the view is displayed **grouped by kind** in that same priority order. An over-length summary
  is rejected at capture (FR-031), never cut at render time. N and the length cap are defaults
  that a module's declaration may override. The overflow line states how many records were
  omitted and points to the full log.
- Q: FR-007 makes records immutable, but the constitution allows redaction of sensitive detail —
  what happens when a record captures a credential or personal data? → A: Redaction is an
  **explicit command, never automatic**. It requires a reason, may replace any field including the
  one-line summary (the view then renders `[redacted]`), and records {date, reason, fields} in the
  record's metadata. CI permits exactly this mutation shape and no other edit to a recorded file.
  The notice MUST state that the original content still exists in git history, and for credentials
  the tool MUST tell the user to rotate them — redaction is not removal. Additionally, capture
  MUST scan content for secrets with deterministic offline patterns and refuse to write on a
  match: automatic capture is the likeliest way a secret enters the repo, and the git extension
  may auto-commit it before anyone reviews it.
- Q: SC-001 backfills the evaluation set from this repo's history — how is that kept honest, given
  a backfilled record is written by someone reading the commit? → A: Every record carries
  provenance. The two populations measure different things and are never merged: **backfilled**
  records measure retrieval only, since their links are correct by construction; **contemporaneous**
  records measure capture quality *and* retrieval. The protocol is blind: the question set and its
  answers are written and committed **before any backfill starts** — commit order is the proof —
  and the backfill process must not read that file. A population with N=0 is reported as "no
  data", never as a pass.
- Q: What happens to a module's records when its declaration is removed or its path renamed? → A:
  Rename and removal are different events. On a **rename or move**, knowledge stays attached: the
  declaration gains `formerly` path globs and records — which stay immutable — resolve through
  them for both views and "why"; per-file "why" additionally follows git's own rename history.
  Only a **true removal** un-covers records, and because the module list is a plain file anyone can
  edit by hand, the "N records un-covered" report MUST come from the CI check on the diff, not
  only from the CLI command.
- Q: What is "the full log" that a truncated view points to? → A: An unbounded rendering produced
  on demand by the same deterministic projection with no N limit — **never committed and never
  stored**; the records stay the only source of truth. It is not a pointer to raw record files,
  because supersession is stated in the *newer* record, so a raw older record cannot show that it
  has been superseded and a reader would take superseded knowledge for current. Records are also
  stored **flat**, not in per-module directories: module membership is computed at render time
  from the declarations, including `formerly` aliases. So the overflow line names the command, not
  a directory.
- Q: A record's implementing commit is written at capture time, but rebases and squash merges
  rewrite exactly those SHAs — what does the link point at afterwards? → A: Nothing stored. The
  implementing commit is **derived** as the commit that added the record's file, which survives
  squash, rebase and amend. A stored `commits` field is kept only for `backfilled` records, whose
  commits are already immutable history.
- Q: Planning surfaced a third kind of provenance — knowledge someone simply told you, with no
  change of its own. Does FR-036 admit it? → A: Yes. Provenance is **{contemporaneous, backfilled,
  oral}**. An oral record has no commit, so it is excluded from SC-002's denominator rather than
  scored as a miss for a citation that could never exist; its retrieval is scored *by content*
  (SC-002a) — does `why` return a record stating the known answer. Like backfilled records it
  measures retrieval, not capture quality: nobody was there to capture it at the time.

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
   **When** the feature is completed, **Then** a knowledge record exists for each thing learned or
   decided, each carrying its kind and a one-line summary — and each record of kind `decision`
   stating the choice, the reasoning and the rejected alternative — linking to the spec and to the
   commits that landed it, with no explicit request from the developer.
2. **Given** decisions already recorded against `src/util/context.ts`, **When** a new spec-kit
   feature begins that will touch `src/util/context.ts`, **Then** those decisions are presented
   to the author before the new spec is written. *(the second time)*
3. **Given** a feature where nothing of consequence was learned or decided, **When** it is
   completed, **Then** no empty or filler record is created, and the change instead carries a
   recorded no-knowledge statement so that no un-clearable flag is left behind.
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

An agent starts work inside a module and is given, automatically, a short view of what is
currently true about that module — the rules that hold now, not the history of how they came to
hold. The view is assembled mechanically from the one-line summaries of the module's current
records, so it never says anything the records do not. What must hold comes before what was once
decided, and a fixed selection rule keeps it within a size budget so it never becomes the thing
that costs too much to read.

**Why this priority**: This is the read path that makes the knowledge pay for itself in day-to-day
agent work, and it is what the token-per-answer metric is compared against. It depends on
captured knowledge existing.

**Independent Test**: Start work in a module with recorded knowledge; confirm a current-truth view
arrives without being requested, measures within budget, and renders identically when produced
twice from unchanged records.

**Acceptance Scenarios**:

1. **Given** a declared module with recorded knowledge, **When** an agent begins work inside it,
   **Then** a current-truth view of that module is provided without being requested.
2. **Given** the module's knowledge has since changed, **When** an agent next begins work there,
   **Then** the view reflects the change and is still within the size budget. *(the second time)*
3. **Given** a module whose accumulated knowledge exceeds the budget, **When** the view is
   produced, **Then** the top N by kind priority then newest-first survive, the view is grouped by
   kind, and an overflow line states how many records were omitted and names the command that
   renders the full log.
6. **Given** a module holding an invariant recorded last year and a decision recorded today,
   **When** the view is produced, **Then** the invariant appears above the decision, because kind
   priority outranks recency.
4. **Given** a path belonging to no declared module, or a declared module with no recorded
   knowledge, **When** an agent begins work there, **Then** nothing is injected — no placeholder,
   no empty section.
5. **Given** an unchanged set of records, **When** the view is produced twice, **Then** the two
   renderings are byte-identical.

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
4. **Given** a flagged PR whose change genuinely taught nothing, **When** the change is given a
   recorded no-knowledge statement, **Then** the flag clears with no record invented, and this is
   not counted as a manual dismissal.
5. **Given** a PR that only changes code belonging to no declared module, **When** it is checked,
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
  Knowledge attached to the old path must not silently vanish or silently follow — it resolves
  through `formerly` globs and git's rename history, both of which are inspectable.
- A file is deleted along with the reason it existed. The decisions that explain its removal must
  remain findable even though the path no longer exists.
- The agent in use is not Claude Code, so no automatic hooks fire. Every capture and read path
  must remain reachable as an explicit command, and the PR flags must still be produced by CI.
- Two knowledge records disagree about current truth and neither is marked superseded. The
  contradiction must be visible rather than resolved arbitrarily by picking one.
- A module accumulates years of decisions. The history must stay complete while the current-truth
  view stays within budget.
- New code is added in a path that belongs to no declared module. By design it raises no flags and
  gets no summary, so the coverage gap is invisible in the PR — it must remain discoverable by
  asking for uncovered paths (FR-026).
- A module declaration's path is renamed or moved while records still reference paths beneath it.
  The records must keep resolving through the declaration's `formerly` globs, unrewritten, and the
  rename must not be reported as a dangling reference.
- A module declaration is removed outright. Its records survive and stay answerable by "why", the
  paths become uncovered, and the count of un-covered records must be reported.
- The module list is edited by hand, or by another tool, rather than through the command that
  manages it. The un-covered count must still be reported, because the check runs on the diff in
  CI rather than inside the command.
- A path is renamed twice, so one declaration accumulates a chain of `formerly` globs. Resolution
  must still reach records recorded under the earliest path.
- A reader opens a record file directly instead of asking for the rendering. That record cannot
  tell them it was superseded, since supersession lives in the newer record — which is why nothing
  in the system may point them there as a substitute for the full-log rendering.
- Two declarations both claim a path, one through its current glob and one through a `formerly`
  glob. The resolution must be defined and stable rather than order-dependent, since FR-032
  requires the same records to render identically everywhere.
- Every current record for a module is superseded and none replaces them. The current-truth view
  must say the module has no current truth recorded, rather than rendering as empty.
- Two branches each record knowledge for the same module and both merge. Identifiers must not
  collide and neither record may be lost — this is what forbids sequential counters (FR-029).
- A routine change touches a declared module and genuinely teaches nothing. It must be closable by
  the no-knowledge statement alone, with no invented record, and the flag must not reappear.
- A change carries a no-knowledge statement but also, in the same diff, contradicts an existing
  current record. The contradiction must still surface (FR-018); the statement closes only the
  did-you-record-anything gap.
- A capture is attempted with no one-line summary, or with one longer than the limit. It must be
  rejected at capture time rather than admitted and shortened at render time (FR-031).
- A module's current records are all of one kind. Grouping must still hold, and the view must not
  render an empty heading for the kinds that have no records.
- A module declaration overrides N or the summary length limit. The override must apply to that
  module's view alone and must not change any other module's, and the view must still be
  byte-identical on every machine.
- Automatic capture produces content that matches a secret pattern. The record must be refused
  with the match reported, not written and cleaned up afterwards — the git extension may commit it
  first. The module then still shows an FR-015 flag, which is correct: the change genuinely has no
  recorded knowledge yet, and the developer must re-capture or record a no-knowledge statement.
- A secret reaches a record despite the scan and is redacted later. The notice must say the
  original is still in git history, and if it was a credential the tool must say to rotate it —
  the redaction alone does not make the credential safe.
- Every current record in a module has had its summary redacted. The view must render each as
  `[redacted]` with its identifier rather than appearing empty or omitting them.
- A success criterion's population turns out to be empty — no contemporaneous records yet, or no
  superseded ones in this history. It must be reported as "no data", never as 100% and never as a
  pass.
- The backfill is run before the question set is committed, or by a process that read it. The
  measurement is void: commit order is the evidence, and a result that cannot show the questions
  were committed first must not be reported.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: System MUST record knowledge as a plain-text **knowledge record** in the
  repository. Every record, of every kind, MUST carry: an identifier (FR-029), a kind, a one-line
  summary (FR-031), the body explaining what is true and why, the date, its provenance (FR-036),
  and the code paths affected.
- **FR-001a**: A knowledge record's kind MUST be one of **decision**, **invariant**, **gotcha**, or
  **convention**. A record of kind `decision` MUST additionally state the alternatives that were
  considered and rejected; the other kinds MUST NOT be required to invent them.
- **FR-002**: System MUST link each knowledge record to the spec that drove it (when one exists)
  and to the commits that implemented it. The implementing commit MUST be **derived** — it is the
  commit that added the record's file — and MUST NOT be stored in the record, so that the link
  survives squash, rebase and amend rather than becoming a dangling reference the moment history
  is rewritten. A record MAY carry a stored `commits` field **only when its provenance is
  `backfilled`**, where it points at history that already exists and will not move.
- **FR-003**: System MUST capture knowledge records on completion of a spec-kit feature without
  the developer explicitly requesting it.
- **FR-004**: System MUST offer to capture knowledge from work done outside spec-kit before a
  session ends or its context is compacted, and MUST make that offer at most once per session.
- **FR-005**: System MUST NOT create a knowledge record when nothing of consequence was
  learned or decided. Such a change satisfies FR-015 through the recorded no-knowledge
  statement of FR-030 instead, so that declining to record never leaves an un-clearable flag.
- **FR-006**: Users MUST be able to record and supersede a knowledge record of any kind
  explicitly, without waiting for an automatic trigger.
- **FR-007**: Knowledge records of every kind MUST be immutable once recorded and MUST be
  supersedable. A record MUST be able to name an earlier record that it supersedes, and the
  earlier record MUST be preserved rather than overwritten or deleted. Corrections are made by
  superseding, never by editing. Redaction (FR-033) is the single exception, and it is a
  replacement of content in place, never a deletion of the record.
- **FR-029**: Record identifiers MUST be unique without coordination — two records created
  independently on concurrent branches MUST NOT collide, and both MUST survive a merge. Sequential
  counters are prohibited. Identifiers MUST also be **sortable by creation time**, since FR-027a
  orders records by identifier rather than by a separate timestamp field. Uniqueness and time
  ordering are both required: an identifier scheme that gives one without the other does not
  satisfy this requirement.
- **FR-031**: Every knowledge record MUST carry a one-line summary, written at capture time, which
  is the unit the current-truth view is composed from (FR-027). A record without one, or whose
  summary exceeds the length limit of FR-013, MUST be **rejected at capture** — summaries are
  never shortened, paraphrased, or cut at render time, and never generated after the fact by any
  other means.

**Retrieval**

- **FR-008**: Users MUST be able to ask why a given file or symbol is the way it is and receive
  the knowledge records that shaped it, of every kind, ordered oldest to newest.
- **FR-009**: System MUST mark superseded records as superseded in every answer, and MUST name
  the record that replaced them.
- **FR-010**: System MUST state plainly when a file or symbol has no recorded knowledge, rather
  than inferring a rationale from the code itself.
- **FR-011**: System MUST surface the existing knowledge records for the paths a new spec-kit
  feature will touch, before that feature's spec is written.
- **FR-012**: System MUST provide a module's current-truth view to an agent beginning work in
  that module, without being asked, and MUST provide nothing when the module has no recorded
  knowledge.
- **FR-013**: System MUST bound each current-truth view by two published limits: a maximum number
  of records **N** in the view, and a maximum length for a one-line summary. Both MUST be
  expressible without a tokenizer. Both are defaults that a module's declaration MAY override
  (FR-024). When records are left out, the view MUST state how many were omitted and name the
  command that renders the full log (FR-040).
- **FR-014**: System MUST reflect subsequent knowledge changes in the current-truth view.

**Integrity**

- **FR-015**: System MUST flag, on a pull request, any declared module whose code changed while
  its knowledge did not. The flag MUST clear when **either** a knowledge record covers the
  change **or** the change carries the recorded no-knowledge statement of FR-030.
- **FR-016**: System MUST flag, on a pull request, any knowledge record referencing a file,
  symbol, or commit that no longer exists.
- **FR-017**: System MUST clear a flag automatically once the gap that raised it is closed, with
  no manual dismissal step. A recorded no-knowledge statement (FR-030) is not a manual
  dismissal: it is part of the change itself, reviewable in the diff, and it closes the gap
  rather than hiding it.
- **FR-018**: System MUST make visible, rather than silently resolve, two current records that
  contradict each other.
- **FR-030**: System MUST let a change state, as part of the change itself and durably (for
  example as a commit trailer), that it carries no knowledge worth recording. The statement
  MUST be visible in an ordinary diff and MUST be attributable to the change that made it.
  This is what SC-007 counts as an explicit, recorded decline.
- **FR-033**: System MUST provide an explicit redaction command — never an automatic one — that
  replaces sensitive content in a recorded knowledge record. Redaction MUST require a stated
  reason, MAY replace any field including the one-line summary, and MUST record {date, reason,
  fields redacted} in the record's own metadata. The notice MUST state that the original content
  still exists in git history, and when the redacted content was a credential the system MUST tell
  the user to rotate it. Redaction hides content going forward; it is not removal.
- **FR-034**: Continuous integration MUST permit exactly one shape of change to an already-recorded
  knowledge record — a redaction conforming to FR-033 — and MUST reject any other edit to it. This
  is what makes FR-007's immutability enforced rather than merely stated.
- **FR-035**: Capture MUST scan a record's content for secrets using deterministic, offline
  patterns, and MUST refuse to write the record when a pattern matches, reporting what matched.
  Automatic capture (FR-003, FR-004) combined with the git extension's auto-commit hooks (FR-023)
  means an unscanned secret could be committed before any human reviews it, so the check belongs
  at capture and not at review.
- **FR-037**: A module rename or move MUST NOT detach its knowledge. The declaration records the
  previous paths as `formerly` globs, and records — which remain immutable and are never rewritten
  to match — MUST resolve through those globs for both the current-truth view and "why" answers. A
  rename handled this way MUST NOT raise the dangling-reference flag of FR-016.
- **FR-038**: A per-file "why" answer MUST additionally follow git's own rename history, so that a
  file that moved without any module change still returns the records that shaped it.
- **FR-039**: Only removing a declaration un-covers its records; the records survive and remain
  answerable by "why". Any change that un-covers records MUST be reported with the count of
  records affected, and that report MUST be produced by the continuous-integration check on the
  diff — not only by the command-line removal path, since the module list is a plain file that can
  be edited by hand or by another tool.
- **FR-036**: Every knowledge record MUST declare its provenance as one of **contemporaneous**
  (captured as the work happened), **backfilled** (reconstructed later from history), or **oral**
  (knowledge conveyed verbally, with no change of its own). A `backfilled` or `oral` record MUST
  name its source — what it was reconstructed from, or who conveyed it.
- **FR-036a**: Measurement MUST report the three populations separately and MUST NOT merge them,
  because they measure different things:
  - **contemporaneous** — capture quality *and* retrieval;
  - **backfilled** — retrieval only, since the links were correct by construction;
  - **oral** — retrieval only, and scored *by content*: an oral record has no commit to cite, so
    it is **excluded from SC-002's denominator** entirely and its retrieval is scored by whether
    `why` returns a record stating the known answer.

**Form and environment**

- **FR-019**: All knowledge MUST be stored as plain text inside the repository, versioned with the
  code it describes.
- **FR-020**: Knowledge changes MUST be reviewable in an ordinary pull request diff, readable
  without special tooling.
- **FR-021**: System MUST work with no network access and no hosted service.
- **FR-022**: Every capture and retrieval path MUST remain available as an explicit command when
  the agent in use provides no automatic triggers, and the pull-request flags MUST be produced by
  continuous integration in that case.
- **FR-042**: When the tool is not installed, or the repository has no knowledge store, every
  agent hook and every local git hook MUST exit successfully and produce **no output**. A
  contributor who has not installed the tool MUST never be blocked, warned, or shown an error by
  it. Continuous integration is the enforcement point — it is the one place where the tool is
  known to be present.
- **FR-023**: System MUST coexist with spec-kit's managed context-file block and with the git
  extension's auto-commit hooks, without corrupting either or being corrupted by them.
- **FR-024**: Modules MUST be explicitly declared in a single list in the repository. A path
  belongs to a module only by virtue of that declaration. A declaration MAY override the view
  limits of FR-013 for that module; where it does not, the published defaults apply. A declaration
  MAY also carry `formerly` path globs naming paths it previously covered (FR-037).
- **FR-025**: System MUST raise no integrity flags and provide no current-truth view for paths
  that belong to no declared module.
- **FR-026**: Users MUST be able to add, move, and remove module declarations, and MUST be able to
  ask which tracked paths belong to no declared module, so that coverage gaps are visible on
  demand rather than silent.
- **FR-027**: The current-truth view MUST be a **deterministic projection** of the module's
  knowledge records: the one-line summaries (FR-031) of the module's current, non-superseded
  records, each shown with its identifier. It MUST NOT be separately authored prose, and it MUST
  NOT be produced by model synthesis, paraphrase, or any other generative step.
- **FR-027a**: Selection MUST rank the module's current records by **kind priority** — invariant,
  then gotcha, then convention, then decision — and within a kind by identifier **newest first**
  (FR-029) — keeping the top N of FR-013. Because identifiers are unique, this ordering is total
  and admits no tie, which is what makes FR-032 achievable.
- **FR-027b**: The view MUST be displayed **grouped by kind**, in the same priority order used for
  selection, so that what must hold is read before what was once decided.
- **FR-027c**: When selection leaves records out, the view MUST carry an overflow line stating how
  many records were omitted and naming the command that renders the full log (FR-040). A view that
  omits nothing MUST NOT carry one.
- **FR-027d**: A record whose one-line summary has been redacted (FR-033) MUST still occupy its
  place in the view, rendered as `[redacted]` with its identifier intact, so that the record's
  existence is never hidden by its redaction.
- **FR-040**: The full log a truncated view points to MUST be an unbounded rendering of the
  module's records, produced on demand by the same deterministic projection with the record limit
  lifted, and marking superseded records as superseded. It MUST NOT be committed or stored: it is
  rendered from the records each time, so it cannot drift from them.
- **FR-040a**: The system MUST NOT direct a reader to raw record files as a substitute for that
  rendering. Supersession is stated in the superseding record, so an older record read on its own
  cannot show that it has been overturned — sending a reader there would present superseded
  knowledge as current, which FR-009 exists to prevent.
- **FR-041**: Knowledge records MUST be stored flat, in one namespace, rather than in per-module
  directories. A record's module membership MUST be computed at render time from the module
  declarations in force, including their `formerly` aliases (FR-037), so that re-declaring or
  renaming a module never requires moving or rewriting an immutable record.

- **FR-028**: System MUST reflect a newly recorded or newly superseded record in the current-truth
  view without a separate update step.
- **FR-032**: The projection MUST be reproducible: the same set of records MUST produce a
  byte-identical view, on any machine, with no network access and no model involved.

### Key Entities

- **Knowledge record**: One durable thing worth knowing about the code, of kind **decision**,
  **invariant**, **gotcha**, or **convention**. Holds a collision-free identifier, its kind, a
  mandatory one-line summary, the body, the date, affected code paths, links to a spec and
  commits, and a status of current or superseded with a pointer to whichever record replaced it.
  Records of kind `decision` also hold the alternatives considered and rejected. A redacted record
  additionally holds redaction metadata: the date, the stated reason, and which fields were
  replaced. Every kind is immutable once recorded — corrections are made by superseding, not
  editing, and redaction is the single exception.
- **Module**: A declared unit of code that knowledge attaches to, named in the repository's module
  list, optionally carrying `formerly` globs for paths it used to cover and overrides for the view
  limits. Paths outside every declared module are simply not covered. Membership is computed at
  render time, never stored on the record.
- **Current-truth view**: A bounded, deterministic projection of what holds now for one module:
  the one-line summaries of that module's current (non-superseded) records, each with its
  identifier, selected by kind priority then newest-first and displayed grouped by kind, with an
  overflow line when records are left out. It is a projection, not a source — never edited
  directly, never synthesised, so it cannot disagree with the records it comes from and the same
  records always render identically.
- **Full-log rendering**: The unbounded form of a module's view — every record, superseded ones
  marked as such — produced on demand from the records and never committed or stored. It is what
  an overflow line names, and it exists because a raw record cannot show that a later record
  overturned it.
- **Knowledge-to-code link**: The association between a knowledge record and the paths, symbols,
  specs and commits it concerns. This is what makes both "why is this file like this" and dangling-reference
  detection possible.
- **Capture event**: An occasion on which knowledge was recorded — a completed spec-kit feature or
  an ad-hoc session — carrying when it happened and what triggered it, so coverage gaps are
  visible.
- **Integrity flag**: An open finding on a pull request: a declared module changed without its
  knowledge, a reference pointing at code that is gone, or two current records in contradiction.
  Raised and cleared by the state of the repository, never dismissed by hand.
- **No-knowledge statement**: A durable, reviewable assertion carried by a change itself, saying
  that the change taught the project nothing worth recording. It closes an FR-015 flag without
  creating a record, and it is what SC-007 counts as an explicit, recorded decline.

## Success Criteria *(mandatory)*

The evaluation set is this repository's own history, which contains three well-understood turning
points to backfill from: the June 2026 gateway build, the July 2026 removal of two tools that
returned wrong answers, and the September 2026 narrowing to project memory.

**Every percentage below MUST be reported with its denominator N.** A percentage without N is not
a result. This matters most for SC-003: this repository's history contains very few decisions that
were later overturned, so its N is expected to be in the low single digits and the percentage on
its own would be noise. Where N is too small to support a percentage, the raw counts MUST be
reported instead.

**A population with N=0 is reported as "no data", never as a pass.** An absent denominator is not
a perfect score.

**The protocol is blind.** The question set and its known answers MUST be written and committed
*before* any backfill begins — the commit order in this repository is the proof — and the backfill
process MUST NOT read that file. Results MUST be reported separately for the two record
populations (FR-036) and never merged: backfilled records measure **retrieval only**, since their
links are correct by construction; contemporaneous records measure **capture quality and
retrieval**.

Numeric targets remain provisional defaults; the clarification sessions set the reporting rules
rather than the thresholds.

### Measurable Outcomes

- **SC-001**: A backfilled evaluation set of at least 20 "why" questions drawn from this
  repository's history, each with a known correct answer agreed before the system is run against
  it.
- **SC-002**: For at least 80% of those questions (reported as *k/N*), the answer cites the
  correct spec or commit for the record it describes — reported separately for backfilled and for
  contemporaneous records, never as one figure. **Records of provenance `oral` are excluded from
  this criterion's denominator**: they have no commit, so a miss here would score a link that
  could never exist. Their retrieval is measured by SC-002a instead.
- **SC-002a**: For at least 80% of questions whose known answer is held only in an `oral` record
  (reported as *k/N*), `why` returns a record **stating that answer** — scored by content, not by
  citation.
- **SC-003**: For at least 90% of questions whose known answer involves a record that was later
  superseded, the answer shows both records and marks the older one superseded — reported as
  *k/N* per population, with N stated even when it is 1 or 2, raw counts given in place of a
  percentage when N is too small to carry one, and "no data" reported when N is 0.
- **SC-004**: Answering a "why" question costs no more than half the tokens of the `git log` +
  `grep` baseline a developer or agent would otherwise use to reconstruct the same answer.
- **SC-005**: Every declared module's current-truth view is within its size budget, measured
  across every declared module, with zero exceptions.
- **SC-006**: A developer or agent gets a usable answer to "why is this like this?" in under 30
  seconds, without leaving the repository or consulting a person.
- **SC-007**: Of features completed through spec-kit, 100% produce knowledge records with no
  explicit request; of sessions that changed code outside spec-kit, at least 80% end with either
  knowledge captured or a recorded no-knowledge statement (FR-030). Both figures reported as
  *k/N*.
- **SC-008**: Every flag raised on a pull request clears on its own once the gap is closed —
  whether closed by a knowledge record or by a no-knowledge statement — with no manual dismissal,
  reported as *k/N* over the evaluation set.
- **SC-009**: Knowledge changes are reviewable as ordinary diffs: a reviewer with no knowledge of
  this feature can read a knowledge change in a PR and say what it records, reported as *k/N*.
- **SC-010**: Every capture and retrieval path works with the network disabled and with an agent
  that fires no automatic hooks.
- **SC-011**: Rendering a module's current-truth view twice from an unchanged set of records
  produces byte-identical output, across every declared module, with zero exceptions — the
  measurable form of "projection, not synthesis".
- **SC-012**: Zero records containing a secret matched by the published patterns are ever written
  by capture, measured over the evaluation set and over a seeded corpus of known secret shapes;
  and every edit to an already-recorded file that is not a conforming redaction is rejected,
  reported as *k/N* over attempts.

## Assumptions

- **Knowledge worth recording** is anything durably useful to a later reader: a decision that
  changed behaviour or an interface, an invariant that must hold, a gotcha that will bite again, or
  a convention the codebase follows. Routine changes that teach nothing are not recorded — FR-005
  keeps the log free of noise, and FR-030's no-knowledge statement is how such a change still
  closes its flag.
- **The developer reviews before it lands.** Automatic capture writes into the working tree and is
  reviewed in the PR like any other change. "Without me asking" (request story 1) is read as "not
  having to request capture", not as "committed without review".
- **Integrity flags are advisory in v1** — visible to the reviewer, not blocking the merge. A
  blocking gate is a team workflow decision that can be turned on later once flag volume is known
  to be low.
- **Supersession is stated, not inferred.** A decision is marked superseded when a new decision
  says so. The system prompts for the link when a new decision touches paths that already have
  current decisions, but does not guess.
- **Nothing derived is committed.** The current-truth view and the full-log rendering are both
  produced from the records on demand. No generated file is stored in the repository, so no
  generated file can fall out of sync with what it was generated from. This is why FR-020's
  "reviewable in an ordinary diff" applies to the records themselves — the diff a reviewer reads
  is the source, not a rendering of it.
- **Redaction hides, git history keeps.** Nothing in this feature can remove content from commits
  that already exist; that needs a history rewrite and, for a credential, rotation. The system's
  obligation is to stop writing secrets (FR-035), to make redaction possible and visible (FR-033),
  and to say plainly what redaction does not achieve.
- **Superseded decisions are kept forever.** There is no pruning in v1; history is the point, and
  the size budget applies to the current-truth view rather than to the archive.
- **Coverage is deliberate, not automatic.** Because modules are declared (FR-024), code outside
  the list is knowingly uncovered rather than accidentally missed. FR-026 exists so that choice
  stays honest — a team can ask what is uncovered instead of discovering it years later.
- **The projected view replaces authored module prose.** Today `update_context` writes authored
  prose to `<module>/.context/domain_logic.md`. Projecting the view mechanically from knowledge
  records (FR-027, FR-032) means that prose stops being the source of truth — and that the view is
  no longer written by a model at all, which removes a class of drift and makes the output
  testable by comparison rather than by judgement. The existing tools' behaviour changes with this
  feature rather than sitting alongside it, and migrating what is already written into knowledge
  records is part of the backfill in SC-001.
- **Spec-kit is present** and the git extension's auto-commit hooks may be enabled; both are
  treated as fixed constraints to coexist with, not as things this feature may change.
- **Claude Code is the reference agent** for automatic triggers. Other agents get the same
  capabilities through explicit commands and CI, per FR-022, and the success criteria are measured
  in the degraded configuration as well.
- **The evaluation set is authored from this repository's history** rather than a synthetic corpus,
  so the known answers are verifiable against real commits and docs — and the blind protocol above
  is what stops the backfill from being written to fit the questions.

## Out of Scope (v1)

- Personal memory that follows a developer across projects.
- Vector databases and embedding-based retrieval.
- Hosted or networked services of any kind.
- Jev reranking, which remains a `bench/` research experiment.
