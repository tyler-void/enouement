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

A spec-kit extension registered in `.specify/extensions.yml`. **Extension id: `enouement`.**

`specify extension search knowledge` (2026-09-21) returned 7 keyword matches — Dotdog, SpecKit
Grill Me, Learning Extension, OKF Knowledge Bundle Generator, Onboard, LLM Wiki, Work IQ — and
none is *named* `knowledge`. But the command prints display names rather than ids and has no
`--json`, so the id could not be shown to be free. Inconclusive is treated as taken: the id is
`enouement`, which the catalog returns nothing for. A generic id in a catalog already full of
knowledge-themed extensions is a poor bet even when it happens to be unclaimed.

| Spec-kit hook | Command | Purpose |
|---|---|---|
| `before_specify` | `enou why --paths <feature paths> --json` | surfaces existing records for the paths a feature will touch, before its spec is written (FR-011) |
| `before_plan` | same | the same records, at planning time |
| `after_implement` | `enou record …` | captures what the feature decided (FR-003) |

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
| Every other agent | `enou view <module>` |

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

## 5. Degradation for people who have not installed it (FR-042)

A repository using this tool will have contributors who have not installed it, and clones that
predate it. For them **every hook is a no-op**: if `enou` is not on `PATH`, or the repository has
no `.knowledge/`, each agent hook and each local git hook **exits 0 and prints nothing**.

Not a warning, not a hint. A teammate who never opted in must not be blocked from committing, and
must not see a message about a tool they did not install — that is how a team decides to delete
the hooks. **CI is the enforcement point**, because it is the one environment where the tool is
known to be present and pinned.

This does not weaken enforcement, it relocates it. The local hook exists to catch work that never
opens a pull request (§1); it cannot also be the guarantee, because it is absent exactly when
someone has not installed the tool.

One exception: when `enou` **is** installed and `lint` fails to run, the git hook exits non-zero.
A lint that silently passes when broken is worse than no lint (Principle II). "Not installed" and
"installed but broken" are different states and are treated differently.

## 6. Latency budget for `PostToolUse(Read)`

This hook fires on **every file read**, so its cost is paid constantly while its benefit is paid
once per module per session. Two budgets, because the two paths are not alike:

| Path | Frequency | Budget |
|---|---|---|
| **Suppressed** — no `.knowledge/`, path in no declared module, or this module already injected this session | almost every read | **p95 < 20 ms**, and it must not read a single record file |
| **Injecting** — first read of a declared module with records | once per module per session | **p95 < 200 ms**, the same budget as `why` |

The suppressed budget is the binding constraint, and it dictates the order of checks: test for
`.knowledge/`, then module membership, then the per-session dedup, and only then touch records.
Scanning the store before discovering there is nothing to inject would put the injecting cost on
every read in the repository.

Measured input: a full record scan costs 153 ms at 10 000 records (research.md §3), which is why
the injecting path gets 200 ms and why the suppressed path must never reach that code.

## 7. Failure behaviour

- View delivery failing must never block a read. Knowledge is an aid on that path; blocking work
  to deliver it inverts the point.
- Any hook that errors while the tool **is** installed reports why on stderr, except where §5
  requires silence.
