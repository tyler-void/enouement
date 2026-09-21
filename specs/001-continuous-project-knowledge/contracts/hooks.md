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

**Spec-kit hooks invoke an agent command, not a shell command.** Verified from the installed git
extension: `extension.yml` declares `provides.commands` as **markdown files**
(`commands/speckit.git.commit.md`), and `.specify/extensions.yml` references them by command name.
The agent reads the markdown and acts on it. So this extension ships three command files, and the
one that captures is a **prompt** — which is where US1's quality actually lives.

| Spec-kit hook | Extension command | What the prompt does |
|---|---|---|
| `before_specify` | `speckit.enouement.recall` | runs `enou why --paths <feature paths> --json` and puts the existing records in front of the author before the spec is written (FR-011) |
| `before_plan` | `speckit.enouement.recall` | the same records, at planning time |
| `after_implement` | `speckit.enouement.capture` | instructs the agent to extract every decision, invariant, gotcha and convention from the finished feature and call `enou record` once per item — **or**, if nothing was learned, to add a `Knowledge-None:` trailer (FR-003, FR-005, FR-030) |

The capture prompt is the difference between a knowledge store that fills with useful records and
one that fills with restatements of the diff. It is specified and reviewed as its own artefact,
not written incidentally while wiring the hook.

**Ordering is load-bearing.** `after_implement` capture MUST run **before** the git extension's
`speckit.git.commit`, so the records land in the same commit as the work they describe rather than
trailing it. In `.specify/extensions.yml` the `after_implement` list is ordered `enouement` first,
`git` second. If that order inverts, records are committed one commit late and every
`Knowledge-Record:` trailer points at the wrong commit — a silent corruption, so the ordering
needs a test, not a comment.

## 3. View delivery: nothing derived is committed

| Agent | Mechanism |
|---|---|
| Claude Code | `PostToolUse(Read)` hook emits the bounded view as `additionalContext`, **once per module per session** |

⚠️ **Unverified assumption — confirm before building US3.** The documentation explicitly describes
`hookSpecificOutput.additionalContext` for **`UserPromptSubmit`** hooks. It was not confirmed that
`PostToolUse` supports the same field. If it does not, the delivery mechanism for US3 has to
change — most likely to `UserPromptSubmit` with the module inferred from the prompt or the
session's recent reads, which is a materially different design with a different dedup story. This
is a US3 blocker, not an MVP one: US1 and US2 do not depend on it.
| Every other agent | `enou view <module>` |

The hook resolves the read file to a declared module and suppresses if that module was already
injected this session. If the read path belongs to no declared module, or the module has no
records, the hook emits **nothing**: no placeholder, no empty section (FR-012).

### Deduplication state — a marker file outside the tree, not memory

**"In-memory per session" cannot work and was wrong.** Every `PostToolUse` invocation is a fresh
process — `sh -c` execs `enou`, which exits. In-memory state is empty on every single run, so the
dedup would never hit and the view would be injected on *every read* in the module, which is the
cost the whole tiering exists to avoid.

State lives in a marker file, outside the repository so nothing derived is ever committed:

```
${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enou/<session_id>/<module-id>
```

`session_id` comes from the hook's stdin JSON — documented as a common field present on every
hook event, alongside `cwd` and `transcript_path`.

**Claim by exclusive create.** The marker is created with `O_EXCL` (`"wx"`): whichever process
creates it injects, and any process that finds it already there suppresses. This is not
belt-and-braces — Claude Code can issue **parallel Read calls**, so two hooks for the same module
genuinely race, and a check-then-write would let both inject. The create *is* the lock.

**Reset on compaction.** The injected view lives in the conversation context, so compaction
removes it — but the marker would survive, and a long session would never see that module's
knowledge again. `SessionStart` has a documented `source` matcher whose values include
**`compact`** (alongside `startup`, `resume`, `clear`, `fork`), so a `SessionStart` hook matching
`compact` clears that session's marker directory. `PreCompact` also exists (its matcher
distinguishing `manual` from `auto`) and would work, but firing *after* the context is gone is the
more robust ordering: it cannot clear markers for an injection that then survives.

Markers are disposable by construction. Losing them costs one redundant injection; keeping a stale
one costs a session's worth of silence, which is why the reset matters more than the cleanup.

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
once per module per session.

**An absolute 20 ms budget for the whole suppressed path is not achievable, and was wrong.**
Process startup alone eats it. Measured p95 for a program that does nothing at all:

| | this machine (200 runs) | 2-vCPU cloud sandbox (200 runs) |
|---|---|---|
| `sh -c 'exit 0'` | **1.5 ms** | **1.5 ms** |
| `bun -e 0` | 8.0 ms | — |
| bun, compiled binary | — | 22.5 ms |
| bun, `run` a `.ts` | — | 25.1 ms |
| `node -e 0` | 22.4 ms (v26.8.2) | — |
| node 22, `.cjs` | — | 29.6 ms |

A 2-vCPU runner is the size a consumer repository's CI is likely to be, and there any runtime
exceeds 20 ms before executing a line of our code. A test asserting 20 ms would pass on a
developer laptop and flake in CI — and faster hardware would only hide the problem rather than
fix it.

So the suppressed path is split in two, and only the first tier runs on every read.

### Tier 1 — POSIX-sh pre-filter, before any runtime starts

The hook `command` is shell, so it can decide not to start a runtime at all:

```sh
[ -d "$CLAUDE_PROJECT_DIR/.knowledge" ] || exit 0
command -v enou >/dev/null 2>&1 || exit 0
exec enou hook post-read "$@"
```

**Budget: p95 < 5 ms, absolute.** Measured at **1.5 ms p95** here — indistinguishable from a bare
`sh -c 'exit 0'`, because that is essentially what it is on the common path.

This is also what makes **FR-042 cheap by construction** rather than a behaviour to implement and
test in application code: in a repository with no `.knowledge/`, or for a contributor who never
installed `enou`, the hook costs one `sh` and produces nothing. There is no code path to get
wrong, because no code of ours runs.

**Verified against the Claude Code hooks documentation** (code.claude.com/docs/en/hooks and
/hooks-guide), not assumed:

- **`$CLAUDE_PROJECT_DIR` is provided to hook commands**, listed under the environment variables
  available to hooks and documented as *set to project root*. The docs themselves use it in
  example commands.
- **Shell form runs through a shell.** A `command` hook *without* an `args` field is spawned via
  `sh -c` on macOS and Linux, so `[ -d … ]`, `command -v`, `||` and `exec` all work. Adding `args`
  switches to exec form and bypasses the shell — the pre-filter therefore **must not** use `args`.

**Verified behaviour of the pre-filter itself** (all four states plus the degenerate one):

| `.knowledge/` | `enou` on PATH | result |
|---|---|---|
| absent | absent | exit 0, no output |
| absent | present | exit 0, no output |
| present | absent | exit 0, no output |
| present | present | `exec enou hook post-read` |
| — | — | `$CLAUDE_PROJECT_DIR` unset → exit 0, no output (fails safe) |

⚠️ **Windows is not covered by this design.** The docs state that shell-form hooks run under Git
Bash on Windows, **or PowerShell when Git Bash is not installed**. PowerShell will not execute the
POSIX pre-filter. So tier 1 works on macOS, Linux and Windows-with-Git-Bash, and needs a separate
answer for Windows-without-Git-Bash. Recorded as an open question on issue #2 rather than guessed
at — the docs specify which shell is used but do not address POSIX semantics on native Windows.

### Tier 2 — store present, but module or dedup miss

`enou` starts, finds the path belongs to no declared module or that this module was already
injected this session, and exits.

**Budget, relative:** p95 ≤ (p95 of an empty program on the same runtime, measured in the same
run) + 5 ms.

Relative because that is what survives a hardware change. The empty-program baseline moves with
the machine; our 5 ms of work does not. An absolute number would encode today's laptop into a
test that CI has to satisfy.

Tier 2 must still open **no record file**. The check order is fixed: store present (tier 1),
module membership, per-session dedup, and only then records.

### Injecting path — unchanged

**p95 < 200 ms**, the same budget as `why`, once per module per session. A full record scan costs
153 ms at 10 000 records (research.md §3), which is where that number comes from.

## 7. Failure behaviour

- View delivery failing must never block a read. Knowledge is an aid on that path; blocking work
  to deliver it inverts the point.
- Any hook that errors while the tool **is** installed reports why on stderr, except where §5
  requires silence.
