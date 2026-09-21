# Contract: Hook and trigger surfaces

**Phase 1 output.** Principle VI: capture is triggered by hooks and CI, never left to anyone's
memory; manual commands are the fallback. Every hook below shells into the CLI contract — no hook
contains logic of its own, so a hook can never disagree with the command a developer runs by hand.

## 1. Enforcement: local hook **and** CI

`lint` runs in both places, deliberately.

| Where | When | Blocking |
|---|---|---|
| `.githooks/pre-commit` | every commit | exit 2 blocks the commit |
| `.githooks/pre-push` | every push | exit 2 blocks the push |
| `.github/workflows/knowledge.yml` | every push and PR | annotates; blocking is a repo setting |

**The CI check reads the PR's commits, not the merge commit.** Squash merges recompose the commit
message, and a `Knowledge-None:` trailer written on one of the branch's commits can end up outside
the merged trailer block or be dropped entirely. Reading only the merged commit would flag changes
that *were* correctly declared — the fastest way to teach a team to ignore a check.

**Why both, and why this is not belt-and-braces.** A solo developer pushing straight to `main`
never opens a pull request, so CI-on-PR alone would guarantee nothing for exactly the workflow
this repository uses today. Conversely a local hook alone is bypassable with `--no-verify` and
absent on a fresh clone. Neither half is sufficient; the pair is. The local hook is installed by
`git config core.hooksPath .githooks`, recorded in quickstart.

Both call the identical command. If they ever disagree, that is a bug in the hook wiring, not a
policy difference — which is the point of having one `lint`.

## 2. Capture: spec-kit extension

A `knowledge` extension registered in `.specify/extensions.yml`:

| Spec-kit hook | Command | Purpose |
|---|---|---|
| `before_specify` | `<cli> why --paths <feature paths> --json` | surfaces existing records for the paths a feature will touch, before its spec is written (FR-011) |
| `before_plan` | same | the same records, at planning time |
| `after_implement` | `<cli> record …` | captures what the feature decided (FR-003) |

**Ordering is load-bearing.** `after_implement` capture MUST run **before** the git extension's
`speckit.git.commit`, so the records land in the same commit as the work they describe rather than
trailing it. In `.specify/extensions.yml` the `after_implement` list is ordered `knowledge` first,
`git` second. If that order inverts, records are committed one commit late and every
`Knowledge-Record:` trailer points at the wrong commit — a silent corruption, so the ordering
needs a test, not a comment.

## 3. View delivery: nothing derived is committed

| Agent | Mechanism |
|---|---|
| Claude Code | `PostToolUse(Read)` hook emits the bounded view as `additionalContext`, **once per module per session** |
| Every other agent | `<cli> view <module>` |

The hook resolves the read file to a declared module, and suppresses if that module was already
injected this session — deduplication state is per-session and in-memory, never a file in the
tree. If the read path belongs to no declared module, or the module has no records, the hook emits
**nothing**: no placeholder, no empty section (FR-012).

This is the one Claude-Code-specific surface in the design. Principle III is satisfied because the
CLI equivalent is not a degraded path — it renders the identical bytes (FR-032), and the hook
itself calls it.

## 4. Capture outside spec-kit (increment US4)

A session-end / pre-compaction hook offers capture at most once per session (FR-004). Declining
is recorded, not silent, so SC-007 can count it. The offer fires only if code changed in a
declared module; a session that changed nothing is never interrupted.

Two constraints taken from prior art (research.md §1), both learned from projects that hit them:

- **The hook must not do the work.** Claude Code's `SessionEnd` hooks share a ~1.5-second budget.
  The hook enqueues and exits; a detached worker does the capture. Doing it inline will be killed
  mid-write.
- **`SessionEnd` and `PreCompact` both fire, and will double-write.** "At most once per session"
  needs more than intent: guard with a state key over the transcript's `size:mtime`, an exclusive
  non-blocking lock, **and** an idempotency check on the write itself. A project that used one
  guard still got duplicate entries.

## 5. Failure behaviour

Every hook fails **open with a message**, never silently:

- CLI missing or errored → the hook prints why and exits 0, except `lint`, which is the enforcing
  path and must exit non-zero when it cannot run. A lint that silently passes when broken is worse
  than no lint (Principle II).
- View delivery failing must never block a read. Knowledge is an aid on that path; blocking work
  to deliver it inverts the point.
