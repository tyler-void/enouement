---
name: speckit-enouement-capture
description: Capture the decisions, invariants, gotchas and conventions a finished
  feature taught, as drafts for a person to accept
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: enouement:commands/speckit.enouement.capture.md
---

# Capture what this feature taught

A feature has just been implemented. Your job is to leave notes for whoever touches this code a
year from now — usually the same person, who will have the code but not this conversation. You
write **drafts** with `enou record`. A person reads them and decides; you never do.

You are running as an `after_implement` hook, **before** the work is committed, so the drafts land
in the same commit as the code they explain.

## 0. Preconditions

- Run `command -v enou`. If it is not installed, say "enou is not installed — knowledge capture
  skipped" and stop. Do not write anything into `.knowledge/` by hand, ever: the tool is what
  validates, scans for secrets and writes the canonical form.

## 1. Gather what happened

- The feature directory: `specs/<feature>/` (spec.md, plan.md, research.md, tasks.md — whichever
  exist). Decisions and their rejected alternatives are usually stated in research.md and plan.md.
- What changed: `git status`, `git diff` and `git diff --staged`, plus the feature branch's commits
  (`git log --oneline <base>..HEAD` when there is a base branch).
- What this conversation actually ran into: errors, surprises, things that took several attempts,
  a measurement that changed a choice. These are the gotchas no diff shows.
- What is already recorded: run `enou why <path>` for each file or directory you changed. Do not
  record again what is already there. If this work **overturns** a current record, the new draft
  supersedes it (`--supersedes <id>`).

## 2. Decide what is worth a draft

Keep a candidate only if the answer to both is yes:

1. **Would a reader a year from now be glad to find it?** They have the code and the git log. They
   do not have this conversation, the spec discussion, or the dead ends.
2. **Does it say something the code does not?** A reason, a constraint, a rejected path, a trap.

Then give it exactly one kind:

| kind | it is | example summary |
|---|---|---|
| `decision` | a choice made between real alternatives — **requires** the alternatives and why each lost | `retry with jitter, not a fixed delay: synchronized clients retried in lockstep` |
| `invariant` | something that must stay true, and what breaks if it does not | `every string scalar in a record is double-quoted; unquoted SHAs parse as numbers` |
| `gotcha` | something surprising that will bite again | `the dev server caches env vars at start: restart after editing .env` |
| `convention` | how this codebase does a thing, so new code matches | `handlers return Result values; only main() turns them into exit codes` |

**Do not record:**
- what the diff already says ("added `parseConfig`", "renamed X to Y", "created module Z");
- the task list, the spec's requirements restated, or the plan's file layout;
- anything obvious from reading the code for a minute;
- temporary state ("tests are flaky right now", "TODO later");
- guesses. If you are not sure why something is the way it is, leave it out.

A typical feature yields **0 to 5** drafts. If you have more than 8, you are restating the diff —
cut back to the ones that pass both questions.

## 3. Write each draft

One `enou record` per item:

```sh
enou record \
  --kind decision \
  --summary "<one line: the claim itself, not a topic>" \
  --paths <the narrowest paths it concerns, comma-separated> \
  --body "<what is true and why: the reason, the evidence, the consequence>" \
  --rejected "<alternative> — <why it lost>" \
  --spec specs/<feature>/spec.md
```

- **Summary**: one line that states the claim ("X, because Y" or "never X: Y happens"). Not a
  heading like "Decision about caching". It must fit the cap (120 characters unless the module
  sets another); if `enou record` refuses it as too long, shorten it — it is never cut for you.
- **Body**: the *why*. Name the evidence — a measurement, a bug, an incident, a constraint — and
  link specs, issues or commits rather than pasting them. A few sentences is usually right.
- **Paths**: the narrowest file or directory the knowledge is about, relative to where you run the
  command. Use `--symbol <path>#<name>` as well when the knowledge is about one definition.
- **Decisions** need at least one `--rejected` (repeat the flag for each alternative), each saying
  why it lost. Other kinds never need one — do not invent alternatives.
- `--spec specs/<feature>/spec.md` whenever a spec drove the work.
- `--supersedes <id>` when this replaces a current record you found with `enou why`.
- Long bodies: write the body to a temporary file outside the repository and pass
  `--body-file <file>`, or pipe it with `--body-file -`.

If `enou record` refuses, read the reason and fix the draft. If it reports a **secret pattern**,
take the credential out — never try to get past the scan by rewording or splitting it.

## 4. When there is nothing worth recording

Write no draft — never a filler one. Tell the person:

> This feature taught nothing worth recording. To say so in the history, add this trailer to the
> commit message: `Knowledge-None: <one-line reason>`

## 5. Finish — hand the decision to the person

Run `enou drafts` and show the list. Then tell the person, in these words or close to them:

> These are **drafts**: nothing treats them as knowledge until you accept them. Read each file in
> `.knowledge/inbox/`, edit anything that is wrong, then run `enou accept <id> …` for the ones that
> are right and `enou reject <id> …` for the rest.

**You never run `enou accept`, `enou reject` or `enou redact`, and you never move or edit files in
`.knowledge/records/`.** Accepting is the person's judgement; doing it for them would make the
drafts trusted without anyone having read them.