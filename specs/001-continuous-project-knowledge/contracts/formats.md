# Contract: On-disk formats

**Phase 1 output.** Field-by-field shapes live in [data-model.md](../data-model.md); this file
states what is *guaranteed* about them. These files are committed, read by humans in diffs, and
parsed by tooling — so their compatibility rules are a contract, not an implementation detail.

## 1. Record file — `.knowledge/records/<ULID>.md` · draft file — `.knowledge/inbox/<ULID>.md`

A draft and a record share **one format**; everything in this section applies to both, except
that a draft is not yet immutable. Which directory a file is in is the only thing that makes it a
draft (data-model §1). Acceptance moves a file from `inbox/` to `records/` under the same name.

**Guaranteed**

- The filename is the record's ID, and the ID is a **monotonic ULID** (26 chars: 48-bit
  timestamp + 80-bit randomness, random component incremented within a shared millisecond).
  Lexicographic filename sort equals chronological order — the whole ordering design (FR-027a)
  rests on this, so an ID scheme that loses it is a breaking change. Plain (non-monotonic) ULID is
  not sufficient: it orders same-millisecond records by random bits.
- One record per file; flat directory; no subdirectories (FR-041).
- YAML front matter delimited by `---`, then a Markdown body. Readable and diffable with no
  tooling (FR-020).
- Once written, a file changes only by a conforming redaction (FR-034).
- **A short SHA is never written unquoted.** 5.59% of 7-character SHAs parse as numbers on Bun
  1.4.0 — `0123456` loses its leading zero and `6e40653` becomes `Infinity`, serialising back as
  `null` (research.md §9).
- **Every string scalar is double-quoted**, and `parse → re-serialise` is byte-identical. Not a
  style preference: unquoted scalars lose data silently on Bun 1.4.0 — an all-digit short SHA
  becomes a number and drops its leading zero, and a summary beginning `#` becomes `null`
  (research.md §9). `lint` enforces the round-trip.
- **The implementing commit is not stored.** It is derived as the oldest commit that added the
  file under either `inbox/` or `records/` (data-model §2.7), which survives squash, rebase,
  amend, and acceptance in a later commit. The optional `commits` field is for **backfilled**
  records only, pointing at history already on `main`.
- **Paths are normalised.** Every `paths` entry and the path part of every `symbols` entry is
  repository-relative with `/` separators, no leading `./`, no repeated `/`, no `..` segment, and
  never absolute. A writer refuses anything else rather than repairing it.
- **Symbols are file-anchored.** A `symbols` entry is `<path>#<name>`. There is no unanchored form:
  a bare name would match an unrelated definition elsewhere and report it as "still exists".
- **Bytes are fixed:** UTF-8, no byte-order mark, `\n` line endings. Setup adds
  `.knowledge/** text eol=lf` to `.gitattributes`, because a checkout that converts line endings
  would break the byte-identical round trip on every record at once.

**Compatibility**

- New optional front-matter keys may be added at any time.
- An existing key may not change meaning or type, and a required key may not be added, without a
  decision record — adding one would invalidate every record already written.
- Unknown keys are preserved on read and never dropped on rewrite, so an older tool cannot silently
  strip a newer tool's field.

**Deliberately absent**: no `status` key, and no approval or reviewer key. Supersession is computed
from whether another *record* names this one (data-model §2.2); draft-ness is computed from the
directory. A stored status could go stale, and a stored approval is a field an agent can type into
its own draft. A move from `inbox/` to `records/` can also be done by hand, but it shows up in
every diff as exactly that move, so it is reviewed as acceptance rather than slipping in as an
edit.

## 2. Module declarations — `.knowledge/modules.yaml`

**Guaranteed**

- One file, one list. A path belongs to a module only by appearing here (FR-024).
- `formerly` globs keep knowledge attached across renames (FR-037); they are additive and never
  removed automatically, since removing one silently detaches history.
- Per-module `view` overrides fall back to `defaults.view`.
- Resolution is **total and order-independent**: a current `path` beats another module's
  `formerly`; then the more specific pattern wins; remaining ties break by declaration order in the
  file (data-model §2.4). Nothing resolves by directory
  iteration order, because FR-032 requires identical rendering on every machine and filesystem
  ordering is not portable.

**Hand-editable by contract.** This file will be edited by hand, by merge resolution, and by other
tools. That is why the un-covered-records report (FR-039) is produced by `lint` on the diff rather
than only by `enou modules remove` — a check that only fires inside a command is a check that
does not fire.

## 3. Git trailers

Two trailers, both plain text in the commit message, both visible in `git log` with no tooling:

| Trailer | Meaning | Requirement |
|---|---|---|
| `Knowledge-Record: <ULID>[,<ULID>...]` | this commit implements these records | FR-002, consumed by `why` |
| `Knowledge-None: <reason>` | this change taught nothing worth recording | FR-030, closes an FR-015 flag |

**Guaranteed**: a commit that touches a declared module raises a flag unless it carries a
`Knowledge-None:` trailer or a `Knowledge-Record:` trailer naming at least one **accepted** record
covering that module. Trailer ids are resolved through the trust predicate (data-model §2.2): an
id that is a draft, or a draft since rejected, neither clears a flag nor appears in a `why` answer
— the trailer is history, and the record it promised does not exist yet, or ever. A commit carrying
both trailers is a contradiction and `lint` reports it rather than picking one.

**Squash merges strip trailers.** A squash merge composes a new commit message from the branch's
commits, and a `Knowledge-None:` trailer written on an individual commit can fall outside the
merged commit's trailer block — or vanish. So the CI check MUST read trailers from **the pull
request's own commits**, not only from the merged commit. A check that reads only the merge commit
will raise flags against changes that were correctly declared, which trains reviewers to ignore
it.

These are trailers rather than a sidecar file so that git is the storage — "link, don't copy"
(constitution, Operating Constraints). They survive rebase and cherry-pick the way any trailer
does, and they are exactly as durable as the commit they annotate, which is the correct lifetime.
