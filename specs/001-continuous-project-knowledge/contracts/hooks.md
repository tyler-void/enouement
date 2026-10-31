# Contract: Hook and trigger surfaces

**Phase 1 output.** Principle VI: capture is triggered by hooks and CI, never left to anyone's
memory; manual commands are the fallback. Every hook below shells into the CLI contract — no hook
contains logic of its own, so a hook can never disagree with the command a developer runs by hand.

## 1. Enforcement: local hook **and** CI

`lint` runs in both places, deliberately.

| Where | When | Runs | Blocking |
|---|---|---|---|
| `.githooks/pre-commit` | every commit | `enou lint --staged` | exit 2 or 3 blocks the commit; exit 1 does not |
| `.githooks/pre-push` | every push | `enou lint --range <remote sha>..<local sha>` per pushed ref | exit 2 or 3 blocks the push; exit 1 does not |
| `.github/workflows/enouement.yml` | every push to `main` and every PR | tests, then `enou lint --range <base>..<head> --json` | tests block; the lint step is advisory (`continue-on-error`) — blocking is a repo setting |

**What each place can judge** (*decided 2026-10-31*). A pre-commit hook runs before the commit
message exists, so it cannot see a `Knowledge-None:` statement and cannot judge FR-015; it checks
the store exactly as it will be committed (the index, not the working tree). FR-015 is judged where
commit messages exist: the pre-push hook, over the commits being pushed, and CI, over the pull
request's own commits. Every mode reports what it did not check (contracts/cli.md, `enou lint`).

For a new branch the pre-push hook measures from where the branch left the remote's default branch
(`refs/remotes/<remote>/HEAD`); when that is unknown it checks the store only, and says so. Deleting
a remote ref checks nothing.

**Installing the hooks in a repository.** They are plain POSIX `sh` files with no logic of their own
beyond the FR-042 pre-filter and exit-code mapping; everything else is `enou lint`.

- A repository with no other git hooks: `git config core.hooksPath .githooks`.
- A repository that already has hooks in `.git/hooks/` (or whose `core.hooksPath` points elsewhere):
  do **not** repoint `core.hooksPath`, which would silently disable the existing hooks. Call ours from
  the existing ones instead — append `"$(git rev-parse --show-toplevel)/.githooks/pre-commit" || exit $?`
  to `.git/hooks/pre-commit`, and the same for `pre-push` passing `"$@"` and stdin through.
- **This repository** is the second case: its `.git/hooks/pre-push` is the public-repository guard,
  and CLAUDE.md forbids overriding `core.hooksPath` here. It is chained, never replaced.

**The CI check reads the PR's commits, not the merge commit.** Squash merges recompose the commit
message, and a `Knowledge-None:` trailer written on one of the branch's commits can end up outside
the merged trailer block or be dropped entirely. Reading only the merged commit would flag changes
that *were* correctly declared — the fastest way to teach a team to ignore a check.

**Why both, and why this is not belt-and-braces.** A solo developer pushing straight to `main`
never opens a pull request, so CI-on-PR alone would guarantee nothing for exactly the workflow
this repository uses today. Conversely a local hook alone is bypassable with `--no-verify` and
absent on a fresh clone. Neither half is sufficient; the pair is. How the local hooks are installed
is above.

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
| `before_specify` | `speckit.enouement.brief` | runs `enou brief <expected paths> --json` and puts the existing records, module views and gaps in front of the author before the spec is written (FR-011, FR-048) |
| `before_plan` | `speckit.enouement.brief` | the same brief, at planning time, over the paths the plan names |
| `after_implement` | `speckit.enouement.capture` | instructs the agent to extract every decision, invariant, gotcha and convention from the finished feature and call `enou record` once per item — **or**, if nothing was learned, to add a `Knowledge-None:` trailer (FR-003, FR-005, FR-030). It ends by listing the drafts it wrote and telling the person to read them and run `enou accept` — it never accepts them itself (FR-044a) |

*Amended 2026-10-31*: the `before_*` command was called `speckit.enouement.recall` and ran `why`.
It is renamed `brief` because `recall` now names the free-text ranker of FR-049, which is a
different thing and does not ship in v1; one name for two things would make the prompt and the
command disagree.

The capture prompt is the difference between a knowledge store that fills with useful records and
one that fills with restatements of the diff. It is specified and reviewed as its own artefact,
not written incidentally while wiring the hook.

**Ordering is load-bearing.** `after_implement` capture MUST run **before** the git extension's
`speckit.git.commit`, so the drafts land in the same commit as the work they describe rather than
trailing it — which is what makes that commit the implementing commit once they are accepted
(data-model §2.7). In `.specify/extensions.yml` the `after_implement` list is ordered `enouement`
first, `git` second. If that order inverts, drafts are committed one commit late and every
`Knowledge-Record:` trailer points at the wrong commit — a silent corruption, so the ordering
needs a test, not a comment.

## 3. View delivery: nothing derived is committed

| Agent | Mechanism |
|---|---|
| Claude Code | `PostToolUse(Read)` hook emits the bounded view as `additionalContext`, **once per module per session** |
| Every other agent | `enou view <module>` |

> **Resolved 2026-09-21 — research.md §10, task T000.** This section first carried a warning that
> `hookSpecificOutput.additionalContext` was documented only for `UserPromptSubmit`, so `PostToolUse`
> might not surface it, which would have forced a different delivery design. The probe on Claude
> Code 2.1.270 found that it **does** surface. The behaviour is still undocumented for
> `PostToolUse`, so T046 re-runs the probe before the hook is built. The warning is kept in git
> history; it is replaced here because, sitting inside the table, it also split the table in two.

The hook resolves the read file to a declared module and suppresses if that module was already
injected this session. If the read path belongs to no declared module, or the module has no
records, the hook emits **nothing**: no placeholder, no empty section (FR-012).

**Only records.** Drafts are never injected (FR-045). An agent's unread draft reaching the next
agent's context as if it were knowledge is exactly what the inbox exists to prevent.

**File-specific records, after the module view** (*added 2026-10-31*). The module view holds the
top N summaries for the whole module, so a gotcha about one particular file can be selected out of
it in a large module. After the view, the hook adds the current records whose `paths` match the
read file **more specifically than the module** — exact file first, then the deepest enclosing
directory — that are not already in the view and were not already injected this session, up to a
limit `view.max_file_records` (a `modules.yaml` key with a published default, overridable per
module like the other view limits of FR-013). The rules that keep this honest:

- the already-injected filter runs **before** the limit, never after it — otherwise records past
  the limit could never be delivered;
- nothing is shortened: each line is a record id and its one-line summary, already bounded by the
  summary cap at capture (FR-031 — summaries are never cut at render time);
- when more records qualify than the limit allows, an **overflow line** names every remaining id
  and the command that shows them (`enou why <file>`), so none is stranded silently;
- dedup uses the same marker directory: one marker per module, as before, plus **one marker per
  file**, claimed with the same exclusive create. The file-specific lines are computed once, on the
  first read of that file in the session.

Path comparison uses the repository-relative form from contracts/cli.md (Repository root), after
resolving symbolic links on both sides, so a symlinked checkout does not make every file look
outside the repository.

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

**As built (2026-10-31, `src/knowledge/hooks.ts`).**

- Layout: `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enou/<session>/view/` holds the delivery markers —
  `m-<module>`, `f-<file>` (the path, URI-encoded; a long path falls back to a 64-bit FNV-1a hash)
  and `r-<record id>`. Session bookkeeping (`start.json`, `offered`, §4) sits beside `view/`, not in
  it, so a reset clears delivery and nothing else.
- `<session>` is the payload's `session_id` when it is a plain token (letters, digits, `-`, `_`),
  otherwise a hash of it — a session id can never name a path outside the marker root. Without a
  `session_id` there is no dedup and every read delivers.
- Reset: `SessionStart` with `source` **`compact` or `clear`** clears `view/`; `startup` and `resume`
  keep it (a resumed conversation still holds what was injected).
- If the environment points the marker root inside the repository, `/tmp/enou` is used instead.
- Marker names use FNV-1a rather than a cryptographic hash: importing `node:crypto` costs ~6 ms
  (measured, research.md §10), more than the whole tier-2 budget. They need to be stable and spread
  out, not secret.

This is the one Claude-Code-specific surface in the design. Principle III is satisfied because the
CLI equivalent is not a degraded path — it renders the identical bytes (FR-032), and the hook
itself calls it.

### Coexistence: tools that replace `Read` (*added 2026-10-31*)

Some code-intelligence MCP servers instruct the agent to read code through their own tools
instead of `Read` (research.md §15). In a session with one of them installed, a `PostToolUse(Read)`
hook may rarely or never fire, and module views silently stop arriving — silent degradation, which
Principle II prohibits. v1 does not chase other tools' input formats. Instead:

- the documented setup states the limitation, and `enou brief` / `enou view` remain the explicit
  path (FR-022);
- a `SessionStart` hook (the same registration that clears markers on `compact`) MUST emit one
  short line naming the declared modules that have knowledge and the command that shows them, so
  an agent whose reads bypass `Read` still learns, at the point of use, that the knowledge exists.
  Documentation alone is not the point of use. The line is a fixed projection of `modules.yaml`
  plus record counts — and the count of drafts waiting, with `enou drafts` — deterministic, behind
  the same tier-1 pre-filter (so FR-042 holds), and empty when there is nothing to name.

### Denying acceptance to agents (*added 2026-10-31*)

The MCP server has no accept, reject or redact tool (FR-044a), but an agent with a shell can run
`enou accept` directly. The documented Claude Code setup therefore adds permission deny rules for
`enou accept`, `enou reject` and `enou redact` in the project's settings. Deny rules are matched against the
command text, so they stop the ordinary case — an agent tidying up its own drafts — rather than a
determined workaround; the move from `inbox/` to `records/` remains visible in every diff
regardless, which is the backstop.

## 4. Capture outside spec-kit (increment US4)

### As built (2026-10-31): a `Stop` hook asks the agent, once

The design below this section assumed a worker that does the capture after the session ends. This
product has no model of its own — the agent's model does every synthesis — and after `SessionEnd`
there is no agent left to ask. So the offer is made **while the agent is still there**, through
Claude Code's `Stop` hook, which fires when the agent finishes a turn.

Verified on Claude Code 2.1.295 by a probe (research.md §10), not assumed: the `Stop` payload
carries `session_id`, `cwd`, `transcript_path` and `stop_hook_active`; printing
`{"decision":"block","reason":"…"}` makes the agent continue with the reason as its instruction;
the `Stop` that ends that continuation arrives with `stop_hook_active: true`.

`enou hook stop`:

1. `stop_hook_active` is true → nothing (it is our own continuation ending).
2. The session already received the offer (marker `offered`) → nothing. **At most once per
   session** is the exclusive create of that marker, plus step 1 — two guards on one decision, and a
   compaction does not reset it.
3. The session changed code in a declared module → otherwise nothing. "Changed in this session" is
   measured against the `start.json` that `enou hook session-start` writes: the HEAD at the start,
   the record and draft ids present, and every path already differing from HEAD with its blob hash.
   A path counts when it differs from the start HEAD (committed since, staged, or not) **and** was
   not already dirty and untouched at the start. Paths under `.knowledge/` and paths in no module do
   not count.
4. The session captured a draft or a record (a new id in the store) → nothing.
5. A commit since the start carries a `Knowledge-None:` trailer → nothing: that is the recorded
   decline (FR-030).
6. Otherwise: block once, with a reason that tells the agent to capture what it learned as drafts
   with `enou record`, to tell the person which drafts to review and accept — never to accept them
   itself — and, if nothing worth recording was learned, to say so to the person, who can put a
   `Knowledge-None:` trailer on the commit. It tells the agent not to invent a record to satisfy the
   reminder (FR-005).

**Declines.** The durable decline is the `Knowledge-None:` trailer — in the change, reviewable, and
what SC-007 counts. Each offer is also appended to `$(git rev-parse --git-dir)/enou/offers.jsonl`
(session, modules, start HEAD, time): inside `.git`, so never committed, and local to the machine.
Joined with the history afterwards (drafts captured, trailers written), it is what lets SC-007's
"sessions that changed code outside spec-kit" be counted at all. Its limit is stated rather than
hidden: a decline voiced in the conversation but never committed leaves only the offer, with no
outcome.

**Why `Stop` and not `SessionEnd`/`PreCompact`.** `SessionEnd` has no agent to ask and a ~1.5 s
budget. `PreCompact` cannot make the agent do anything. `Stop` fires at the end of the very turn in
which the work was done, which is also when what was learned is freshest.

### Superseded 2026-10-31 — the design this replaced

*Kept as written, per Principle IV. It assumed the capture could be done without the agent.*

A session-end / pre-compaction hook offers capture at most once per session (FR-004). Declining
is recorded, not silent, so SC-007 can count it. The offer fires only if code changed in a
declared module; a session that changed nothing is never interrupted.

Two constraints taken from prior art (research.md §1), both learned from projects that hit them:

- **The hook must not do the work.** Claude Code's `SessionEnd` hooks share a ~1.5-second budget.
  The hook enqueues and exits; a detached worker does the capture. Doing it inline will be killed
  mid-write.
- **What the worker writes is drafts** (FR-043), like every capture path — never records. The
  session has ended by then, so the person learns of them at the point of use: the next
  `SessionStart` line counts the drafts waiting (§3, Coexistence), and `lint` and every `brief`
  list them (FR-050). They become records only when the person runs `enou accept`.
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

How the git hooks map `enou lint`'s exit codes (*implemented 2026-10-31*, tested in
`test/githooks.test.ts`): 0 passes; 2 (findings) and 3 (internal error) — or any other non-zero —
block; 1 (`enou` refused its own arguments, a problem with the hook rather than with the change)
does not block, but prints one line saying the change was not checked. Silence is reserved for
"not installed" and "no store here"; an installed tool that did not check says so.

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

`enou` starts, finds the path belongs to no declared module, or that **both** this module's marker
and this file's marker already exist this session (§3), and exits. Both are checked by the
existence of a marker file alone — the file-specific lines of §3 are computed only on the first
read of each file, so a repeat read never needs to open a record to know it has nothing new.

**Budget, relative:** p95 ≤ (p95 of an empty program on the same runtime, measured in the same
run) + 5 ms.

Relative because that is what survives a hardware change. The empty-program baseline moves with
the machine; our 5 ms of work does not. An absolute number would encode today's laptop into a
test that CI has to satisfy.

Tier 2 must still open **no record file**. The check order is fixed: store present (tier 1),
module membership, per-session dedup (module marker, then file marker), and only then records.

**Measured 2026-10-31 — the budget is NOT met** (research.md §10). A miss costs about **+8.5 ms
(p50)** over an empty `bun` program when `enou` runs from TypeScript source, and **+6.6 ms** from a
single-file `bun build` bundle; the hook's own work is under 0.1 ms. The rest is runtime start-up and
module loading: `node:fs` + `node:path` alone cost ~2.6 ms. What was cut on the way: lazy loading of
command handlers (every command, not only the hook, paid for loading all of them) and of the view
code, and dropping `node:crypto` from the read path (~6 ms). Closing the remaining gap belongs to
spec 002's packaging choice — a bundle or a compiled binary — not to more code here. "Opens no record
file" holds and is tested; the latency test is a regression guard at +15 ms, labelled as such, not a
claim that +5 ms holds.

### Injecting path — unchanged

**p95 < 200 ms**, the same budget as `why`, once per module per session. A full record scan costs
153 ms at 10 000 records (research.md §3), which is where that number comes from.

## 7. Failure behaviour

- View delivery failing must never block a read. Knowledge is an aid on that path; blocking work
  to deliver it inverts the point.
- Any hook that errors while the tool **is** installed reports why on stderr, except where §5
  requires silence.
