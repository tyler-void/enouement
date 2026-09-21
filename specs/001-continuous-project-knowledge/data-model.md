# Data Model: Continuous Project Knowledge

**Phase 1 output** · Derived from [spec.md](spec.md) requirements FR-001…FR-041.

> **Reconciled 2026-09-21.** This model's third provenance value, `oral`, was a divergence from
> FR-036 when first written. FR-036 has since been amended to admit it, and FR-036a and SC-002a
> now define how the three populations are measured. The divergence is recorded rather than
> erased, per Principle IV.

## 1. Storage shape

Records are **flat**: one file per record at `.knowledge/records/<ULID>.md`, in a single
namespace, never in per-module directories (FR-041). Module membership is computed at render time
from the declarations in force, so re-declaring or renaming a module never rewrites an immutable
record.

A record file is YAML front matter followed by a Markdown body. Front matter is parsed with
`Bun.YAML` — a built-in, so this costs no dependency.

```markdown
---
id: 01JBQ7K3M2N8P4R6T9V0W1X2Y3
kind: decision
summary: retrieval tools removed; the wrapped tools ship their own MCP servers now
provenance:
  origin: contemporaneous
  source: specs/001-continuous-project-knowledge/spec.md
  date: 2026-09-21
paths:
  - src/server.ts
  - src/backends/
spec: specs/001-continuous-project-knowledge/spec.md
commits:
  - 7c000ac
supersedes: 01JBQ5H1F0C7B3A9Z8Y7X6W5V4
rejected:
  - kept the gateway and re-measured it — the wrapped tools now ship their own MCP servers
---

Body: what is true, and why. Links to commits, specs and PRs rather than quoting them.
```

## 2. Entities

### 2.1 Knowledge record

The only durable entity. Everything else is either a declaration or something computed.

| Field | Required | Rule |
|---|---|---|
| `id` | yes | ULID, **monotonic variant** — 48-bit timestamp + 80-bit randomness, incrementing the random component within a shared millisecond. Time-sortable **and** collision-free without coordination (FR-029). Plain lexicographic string sort equals chronological sort, which is what makes FR-027a's ordering free; the monotonic variant is what makes it hold for records written in the same millisecond |
| `kind` | yes | One of `decision`, `invariant`, `gotcha`, `convention` (FR-001a) |
| `summary` | yes | One line. Rejected at capture if absent or over the length cap — never shortened at render (FR-031) |
| `body` | yes | What is true and why. Links rather than copies (constitution, Operating Constraints) |
| `provenance.origin` | yes | `contemporaneous` \| `backfilled` \| `oral` — see the divergence note above |
| `provenance.source` | yes when `backfilled` or `oral` | What it was reconstructed from, or who conveyed it |
| `provenance.date` | yes | When the record was written (distinct from the date of what it describes) |
| `paths` | yes | Code paths the record concerns. Globs allowed |
| `spec` | no | The spec that drove it (FR-002) |
| `commits` | no | **Optional, and only for `backfilled` records** pointing at history already on `main`. The *implementing* commit is **derived, never stored** — see §2.7 |
| `supersedes` | no | ID of the record this one overturns (FR-007) |
| `rejected` | yes **iff** `kind: decision` | Alternatives considered and rejected. Other kinds must not be made to invent them (FR-001a) |
| `redaction` | no | Present only on a redacted record: `{date, reason, fields[]}` (FR-033) |

**Immutability.** A record file is never edited after it is written. The single permitted
mutation is a conforming redaction, and `lint` rejects every other edit to an existing record
file (FR-034). This is enforced mechanically, not by convention.

### 2.2 State

Status is **not a stored field** — it is computed, which is what stops it going stale:

```
current     ─── a newer record names this one in `supersedes` ──▶  superseded
   │                                                                   │
   └──────────────── redact (the only mutation) ───────────────────────┘
                     redaction is orthogonal: a redacted record keeps
                     whichever status it had
```

A record is `superseded` iff some other record names it in `supersedes`. Nothing writes back to
the older file — which is precisely why a raw record cannot show its own supersession, and why
FR-040a forbids pointing readers at raw files.

**Ordering is by the graph, not by the clock.** Within a supersession chain, "oldest to newest"
(FR-008) follows the `supersedes` edges — a record that supersedes another is newer than it, by
definition and regardless of timestamps. The identifier is only the **deterministic tie-break
between unrelated records**, where no edge relates them.

This matters because the monotonic ULID guarantees ordering **within one process only**. Two
developers on two machines with skewed clocks can mint IDs whose lexicographic order contradicts
the real sequence; the `supersedes` edge cannot be wrong that way, because whoever wrote the newer
record had the older one in front of them. Sorting a chain purely by ID would silently reorder
history across machines — deterministic, reproducible, and wrong.

### 2.3 Provenance populations

The three origins measure different things and are never merged into one figure (FR-036):

| Origin | Links correct by construction? | What a result measures |
|---|---|---|
| `contemporaneous` | no | capture quality **and** retrieval |
| `backfilled` | yes — written by someone reading the commit | retrieval only |
| `oral` | no commit exists to link | **retrieval only, scored by content** — `why` must return a record stating the known answer (SC-002a). Not capture quality: nobody was present to capture it at the time |

`oral` records **cannot** satisfy SC-002, which scores citing the correct commit — so FR-036a
excludes them from its denominator and SC-002a scores them by content instead. Counting them as
misses would penalise the system for a link that never existed.

### 2.4 Module declaration

`.knowledge/modules.yaml` — the single list. A path belongs to a module only by virtue of this
file (FR-024).

```yaml
modules:
  - path: src/knowledge
    formerly: [src/decide, src/backends]   # renames keep knowledge attached (FR-037)
    view: { max_records: 25, max_summary: 120 }   # per-module override of FR-013 defaults
  - path: bench/src/experiments/jev-rerank
defaults:
  view: { max_records: 20, max_summary: 120 }
```

Matched with `Bun.Glob`. Resolution must be **total and order-independent**: when a path is
claimed by one module's `path` and another's `formerly`, the current `path` wins, and ties beyond
that are broken by declaration order in the file — recorded so FR-032's byte-identical rendering
cannot depend on directory iteration order.

### 2.5 Computed, never stored

| Thing | Computed from | Never |
|---|---|---|
| **Current-truth view** | current records for the module, ranked by kind priority (invariant → gotcha → convention → decision) then ULID descending, top N, grouped by kind, plus an overflow line naming the full-log command | written to disk |
| **Full-log rendering** | every record for the module, superseded ones marked | written to disk |
| **Integrity flag** | the diff plus the store | stored or hand-dismissed |
| **Record status** | the presence of a superseding record | stored on the record |
| **Module membership** | declarations + `formerly` globs, at render time | stored on the record |

### 2.6 No-knowledge statement

Not a record — an assertion carried by the change itself, as a git trailer (FR-030):

```
Knowledge-None: routine dependency bump, nothing learned
```

It closes an FR-015 flag without creating a record, is visible in an ordinary diff, is
attributable to the change that made it, and is what SC-007 counts as an explicit recorded
decline. It is **not** a manual dismissal under FR-017 — it is part of the change, not an action
on the flag.

### 2.7 Implementing commits are derived, not stored

The commit that implemented a record is **computed**, not written into the record:

```
git log --diff-filter=A --format=%H -- .knowledge/records/<id>.md
```

The commit that *added the record file* is the commit the record belongs to, by construction. This
survives squash, rebase and amend — a stored SHA does not, and a stored SHA that has been rebased
away is a dangling reference (FR-016) created by our own storage choice rather than by anything a
user did.

This is the reading of FR-002 ("link each knowledge record … to the commits that implemented it")
that the design takes: deriving the link satisfies it, and does so more durably than recording one.
The optional stored `commits` field remains for **backfilled** records only, where the record is
written long after the commits it describes and those commits are already immutable on `main`.

### 2.8 Canonical serialisation

Records are written by a **canonical writer**, never by a general YAML dump:

1. **Every string scalar is double-quoted.** Measured on Bun 1.4.0 (research.md §9), unquoted
   scalars fail in three ways, two of them silent:
   - `commits: 0123456` → the number `123456` — the leading zero is **lost silently**. A 6-char
     hex SHA is all-digits 5.96% of the time, a 7-char one 3.73% (derived: (10/16)ⁿ).
   - `summary: #42 fixed` → `null` — `#` opens a comment and the value **disappears silently**.
   - `summary: why this: matters` → a parse error. Loud, but a summary is free text and will
     contain `": "`.
2. **Types are validated after parsing**, not assumed: `commits` are hex strings, `date` is a
   `YYYY-MM-DD` *string*, `id` is a 26-char ULID. A value that parsed as a number where a string
   was required is a validation failure, not something to coerce.
3. **Round-trip must be byte-identical.** `lint` parses each record and re-serialises it with the
   canonical writer; any byte difference is a finding. This is what keeps the writer honest and
   makes hand-edits visible rather than quietly normalised on the next write.
4. **A record that fails to parse fails `lint`, and `why` reports the error** for that record
   rather than skipping it. A malformed record silently omitted from an answer is exactly the
   confident-wrong-answer failure Principle II prohibits — the answer would look complete.

`Bun.YAML.stringify` exists but is not used for writing: its output is not a stability contract,
and requirement 1 above is stricter than what a general serialiser will emit.

## 3. Validation rules

Applied at capture; each maps to a requirement and to a test:

1. `summary` present and within the cap → else **reject** (FR-031). Never truncate.
2. `kind` in the enum → else reject (FR-001a).
3. `kind: decision` ⇒ `rejected` non-empty → else reject (FR-001a).
4. `id` is a well-formed ULID, and unused → else reject (FR-029).
5. Secret patterns do not match any field → else **reject and report what matched** (FR-035).
   Runs before the file is written, because automatic capture plus the git extension's auto-commit
   can otherwise commit a secret before any human sees it.
6. `provenance.origin` present; `source` present when `backfilled` or `oral` (FR-036).
7. `supersedes`, if present, names an existing record → else reject.
8. An existing record file may change **only** by a conforming redaction → else `lint` fails
   (FR-034).
9. Every string scalar is double-quoted, and parse → re-serialise is byte-identical → else `lint`
   fails (§2.8).
10. Parsed types match the schema — `commits` hex strings, `date` a `YYYY-MM-DD` string → else
    reject. Never coerce a number back into a string.
11. A record that does not parse fails `lint`, and `why` reports it rather than omitting it.

## 4. Why there is no index

Measured, not assumed (research.md §3): a brute-force scan with real `Bun.YAML` parsing costs
153 ms at 10 000 records — under the 200 ms target at the derived 10-year volume. An index would
be a derived artefact that can drift from its source, which is the exact failure the projection
design exists to avoid. **No index in v1**; the measured revisit trigger is ~25 000 records.
