---
name: enouement
description: >-
  Work with enouement (the `enou` CLI): repo-native project knowledge that remembers WHY the code is the
  way it is. Before changing code, ask what is already known (`enou brief`, `enou why`) and respect it;
  after finishing work, capture decisions, invariants, gotchas and conventions as drafts for the person to
  accept; and set enouement up in an existing project. Use this whenever the repository has a
  `.knowledge/` directory, whenever the user mentions enouement, enou, project knowledge, project memory,
  "remember this decision", "why is this like this", or asks to install or set up knowledge capture in a
  repo — and when you finish a change in a repo that uses it, even if nobody asks you to record anything.
---

# enouement

enouement keeps a project's reasoning in the repository, next to the code it explains. Each piece of
knowledge is a small Markdown **record** in `.knowledge/records/`, reviewed in ordinary diffs and
committed with the code. Records never change after acceptance: a wrong one is *superseded* by a newer
one, so the history of why things changed survives.

The part that matters most for you as an agent: **you write drafts, a person accepts them.** Everything
you capture goes to `.knowledge/inbox/` and is not knowledge until the person runs `enou accept`. That
gate is the whole trust model — an agent's unread guess must never be served to the next agent as fact.
So you never accept, reject or redact anything yourself, even when asked; you tell the person the
command (in Claude Code they can type `! enou accept <id>` to run it in this session).

## Is it here?

```bash
command -v enou && ls -d .knowledge
```

- Both present → follow the workflow below.
- `enou` missing or no `.knowledge/` → if the user wants it set up, read `references/setup.md` and do
  that. Otherwise carry on normally; never create `.knowledge/` uninvited.
- Run `enou` from anywhere in the repo; it finds the root itself.

## Before you change code: find out what is known

```bash
enou brief src/billing/invoice.ts src/billing/tax.ts   # the paths you are about to touch
enou why src/billing/tax.ts                             # one file — or a symbol: enou why roundTax
```

`brief` gives the records affecting those paths, each module's current-truth view, and the gaps (paths
no module covers, modules with nothing recorded, drafts waiting). `why` gives the records that shaped a
file or symbol, oldest first, superseded ones marked.

Treat current records as constraints the project chose on purpose. If your change would contradict one,
stop and say so before writing code: quote the record id and summary, and ask whether the decision
still holds. If the person says it no longer does, the change is legitimate — and the new knowledge
must *supersede* the old record (below), never quietly diverge from it.

If `why` says there is no recorded knowledge, that is the answer. Don't invent a rationale from the code.

When a Claude Code hook is installed, reading a file in a declared module injects that module's view
automatically; that text is the same thing `enou view <module>` prints.

## After the work: capture what a future reader would need

Ask: *a year from now, someone changes this code — what will they wish they had been told?* Record
that, and only that. Good records are:

- **decision** — a choice that shaped behaviour or an interface, **with the alternatives rejected and
  why**. ("Store money as integer cents; floats rejected because rounding drifted in tax totals.")
- **invariant** — something that must stay true. ("Every write to `orders` goes through `OrderRepo`;
  triggers depend on it.")
- **gotcha** — something that will bite again. ("`Date` in the CSV export is local time, not UTC.")
- **convention** — how this codebase does a thing. ("Route handlers never throw; they return `Result`.")

Not worth a record: what the diff already says, a routine bump, a rename, anything the code states
plainly. One item per record. If nothing of consequence was learned, record nothing and tell the person;
they can mark the commit with a `Knowledge-None: <reason>` trailer so the integrity check knows it was
deliberate.

```bash
enou record --kind decision \
  --summary "store money as integer cents, never floats" \
  --paths src/money.ts,src/billing/ \
  --symbol src/money.ts#toCents \
  --rejected "floats: rounding drifted in tax totals" \
  --rejected "a decimal library: one more dependency for one function" \
  --body-file - <<'MD'
Every amount in the database and in memory is an integer number of cents. Conversion happens only at
the edges (`toCents` on input, `formatMoney` on output).

Floats were used until 2026-03 and produced one-cent mismatches between invoice lines and totals.
MD
```

- `--summary` is one line within the module's cap (120 characters by default). It is never cut for
  you; if it is refused as too long, write a shorter one.
- `--paths` are relative to where you run the command; directories end with `/`; globs are fine.
- `--symbol path#name` when one definition is the point — it lets `enou why name` find the record.
- `--rejected` is required for a decision. If no alternative was really considered, it is probably not
  a decision; use another kind.
- Use a quoted heredoc (`<<'MD'`) for the body so the shell does not expand anything inside it.
- If a current record is being overturned, add `--supersedes <id>` (find the id with `enou why`). Never
  edit a file in `.knowledge/records/`; `lint` rejects any change there except a redaction.
- `--provenance oral --source "<who said it>"` when the person told you something with no change of
  its own; `--provenance backfilled --source "<commit or PR>"` when reconstructing past decisions.

When `record` refuses, fix the cause; never work around it. A **secret-pattern** refusal means the text
contains something credential-shaped: remove it (describe *where* the secret lives, never its value)
and, if a real credential was involved, tell the person. Nothing was written, so there is nothing to
clean up.

Then hand over:

```bash
enou drafts
```

Tell the person how many drafts you wrote, with their ids and summaries, and that they become knowledge
only when they run `enou accept <id>...` (or `enou reject <id>`) after reading them — editing a draft
first is fine. Commit drafts together with the work they describe; acceptance can happen in a later
commit.

## Commands

| Command | What it does |
|---|---|
| `enou brief <paths>...` | what to know before touching these paths: records, module views, gaps |
| `enou why <path \| symbol \| path#name>` | the records that shaped it, oldest first |
| `enou view <module>` / `enou log <module>` | a module's current truth / its full history |
| `enou show <id>` | one record or draft, with its status and implementing commit |
| `enou record ...` | capture a draft (above) |
| `enou drafts` | drafts waiting for the person |
| `enou modules list \| uncovered \| add \| move \| remove` | module declarations |
| `enou lint` | integrity check; exit 2 means there are findings |
| `enou accept` / `reject` / `redact` | **the person's steps — never run them yourself** |
| `enou recall` | not available: free-text search ships only once it is measured |

Exit codes: 0 ok · 1 refused (your input; read the message) · 2 lint findings · 3 the tool broke
(report it, with `ENOU_DEBUG=1` for a stack trace).
