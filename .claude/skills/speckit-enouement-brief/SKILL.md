---
name: speckit-enouement-brief
description: Put the recorded knowledge about the paths a feature will touch in front
  of the author, before the spec or plan is written
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: enouement:commands/speckit.enouement.brief.md
---

# Brief the author before the spec or plan is written

Before anyone writes a spec or a plan, show them what this repository already knows about the
code they are about to change: decisions already made (and the alternatives already rejected),
invariants that must keep holding, gotchas, conventions. Reading this first is how a feature avoids
quietly contradicting a choice that was made on purpose.

## 0. Preconditions

- Run `command -v enou`. If it is not installed, say "enou is not installed — no knowledge brief"
  and continue with the spec or plan as normal.

## 1. Work out which paths the feature will touch

- `before_specify`: from the feature description, find the files and directories it is likely to
  change — search the repository (file names, symbols, the code the description mentions). Prefer
  directories when you are unsure; a few good paths beat many guesses.
- `before_plan`: use the spec, and any paths the draft plan already names.

## 2. Ask the repository

Run, with every path at once:

```sh
enou brief <path> <path> …
```

If it answers `not built yet` (an older enou), fall back to asking per path:

```sh
enou why <path>
```

## 3. Present it — before writing anything

Show the author, briefly:

- **What must keep holding**: current invariants and conventions for those paths, with their ids.
- **What was already decided**: current decisions, with the alternatives they rejected — so the
  spec does not reopen a settled question by accident.
- **Gotchas** that apply.
- **Gaps** the brief reports: paths no module covers, modules with no knowledge, drafts still
  waiting for acceptance.

If the feature as described would **contradict a current record**, say so plainly and name the
record. The author decides whether the record still holds; if it does not, the work should end
with a decision that supersedes it (`--supersedes <id>` at capture time).

## Rules

- Report only what the commands return. Never infer a reason from the code and present it as
  recorded knowledge. If nothing is recorded, say "no recorded knowledge for these paths".
- Drafts are not knowledge. Mention that drafts are waiting if the brief says so, but do not treat
  their content as settled.
- This step only reads. It never runs `enou record`, `enou accept`, `enou reject` or
  `enou redact`.