# Phase 0 Research: Continuous Project Knowledge

Every claim below is labelled **measured**, **derived**, or **cited**, per constitution
Principle I. Where something is unmeasured it says so and carries a task, rather than an estimate
dressed as a finding.

## 1. Prior art — **cited** (repos cloned and read 2026-09-21)

Three projects in this exact space were read at source. All three are single-author with ≤1 star;
only cairnkeep is published (npm `@cairnkeep/cli` v2.17.3, 1,130 downloads in the month to
2026-09-20). **None of the three publishes a measured result** — VampiricCyborg's README says its
metrics table is "targets, not results. Nothing in this repository has been benchmarked yet."
That is the gap SC-001…SC-012 exist to fill.

| Project | Store | Committed? | IDs | Licence |
|---|---|---|---|---|
| [VampiricCyborg/Cairn](https://github.com/VampiricCyborg/Cairn) | `.cairn/`, one Markdown file per entry, YAML front matter | **yes** | `{type}-{6 hex}` = truncated SHA-256 | MIT |
| [asitha-w/cairn](https://github.com/asitha-w/cairn) | Markdown graph: `work/`, `systems/`, `people/` | **yes** (derived state gitignored) | path slug, e.g. `work/product-431` | MIT |
| [cairnkeep](https://github.com/cairnkeep/cairnkeep) | SQLite in gitignored `.agentfs/` + `~/.cairnkeep/` | **no** | user-supplied path + monotonic-timestamp+UUID history | Apache-2.0 |

### Adopted

- **Capture at session end must be asynchronous.** VampiricCyborg's `SessionEnd` hook only
  enqueues a job and exits, then detaches a worker — because Claude Code's `SessionEnd` hooks
  share a **1.5-second budget**. Our FR-004 capture cannot do its work inline. *Carried into
  contracts/hooks.md §4 as a constraint, not a preference.*
- **`SessionEnd` and `PreCompact` both fire, and will double-write.** asitha-w hit this and fixed
  it three ways at once — a state file keyed on transcript `size:mtime`, an `fcntl` lock, **and** a
  literal "is this line already present" check. Their commit message names the bug: "overlapping
  runs used to append the same line twice." FR-004's "at most once per session" is exactly this,
  and one guard is not enough.
- **Never store transcript content.** asitha-w's folder keeps date, session id, call count and two
  command heads — "never keeps tool output, prompts or file contents." Cheap privacy by
  construction, and it complements rather than replaces our FR-035 secret scan.
- **Monotonic identifiers within a millisecond.** cairnkeep forces strictly increasing history keys
  with `lastMutationTime = Math.max(now, lastMutationTime + 1)`. Canonical ULID does **not**
  guarantee this: two records in the same millisecond order by their random bits, not by creation
  order. This is deterministic (FR-032 holds) but not chronological, and FR-027a orders by
  identifier. **Decision amended: use the monotonic ULID variant**, incrementing the random
  component within a shared millisecond. Found by reading cairnkeep, not by reasoning about ULID.
- **Deterministic gates before any model.** VampiricCyborg runs schema → tombstone → near-duplicate
  → contradiction checks with rapidfuzz, and the curator "never adjudicates" — it flags for a
  human. Independent confirmation of Principle VI.

### Rejected

- **Truncated-hash identifiers.** VampiricCyborg's 6 hex characters is 24 bits; a birthday
  collision becomes likely around **~4,800 entries** — *below* our derived 10⁴ design volume (§2).
  Their v0 caps at 100 approved entries so it does not bite them. It would bite us. Vindicates §5.
- **Mutable entries.** VampiricCyborg rewrites the target entry in place, appending an
  `## Amendment` section and bumping `updated`. We supersede instead (FR-007) — a record that can
  be edited cannot be trusted to say what was believed at the time.
- **Committing a generated context file.** VampiricCyborg's `CONTEXT.md` is written **empty** at
  `init` and never regenerated, despite the README calling it "generated: the injectable context
  block" — the only two references in the source are the init write and an echo of its path. A
  committed derived file that silently never updates is precisely the failure FR-040 and
  "nothing derived is committed" exist to prevent. Observed, not hypothesised.
- **Committing unreviewed extraction.** VampiricCyborg commits `staging/`, putting un-reviewed
  model output into git history permanently.
- **A gitignored binary store.** cairnkeep is the deliberate contrast: SQLite under gitignored
  `.agentfs/` plus `~/.cairnkeep/`, with *nothing* knowledge-bearing committed. It is the most
  mature of the three and it has **no "review the entry in the PR diff" story at all** — team
  sharing is a manual, allowlist-only context-pack export. Binary also means no `cat`, no
  `git diff`, no hand-edit. That is the direct inverse of FR-019/FR-020, which are our central bet.

### Engaged with, not adopted — the accept gate

**All three projects independently converged on a human accept gate between extraction and durable
storage**: VampiricCyborg stages to `staging/` for `cairn review`; asitha-w gives producers only
`gh_*` and `Log` while a human owns every judgement field; cairnkeep stages at `SessionEnd` and
writes only via `/memory-review`, stating the rationale as "no premature/auto writes, no AgentFS
lock contention".

We have no such gate: FR-003 captures automatically and the PR diff is the review. Three
independent arrivals at the same answer is a real signal and is recorded as such rather than
dismissed. The defensible difference is that **our store is committed, so the PR diff is a
review gate that none of the three has** — cairnkeep in particular stages precisely because its
store is invisible to review. The risk we accept: work that never opens a PR (a solo developer
pushing to `main`) gets no gate at all. That is the same hole `lint`-in-a-local-git-hook exists to
cover, and it is the argument for that hook, not only for CI.

### Cautionary

cairnkeep ships **27 MCP tools and ~230 Markdown docs** for a memory layer. This repository removed
five of seven tools in 2026 for being unmeasured or wrong; the two-tool surface is a deliberate
inversion of that trajectory. Complexity is the failure mode most visible in the prior art.

## 2. Record volume at a 10-year horizon — **derived**

**Question**: how many records could a 10-year brownfield repository accumulate?

No repository with a decade of *this* kind of record exists to measure, so this is derived from
stated parameters. The arithmetic is shown so the reader can substitute their own:

| Parameter | Conservative | Aggressive |
|---|---|---|
| PRs landed per week | 20 | 50 |
| Fraction yielding a record (FR-005 excludes routine changes) | 0.25 | 0.5 |
| Records per week | 5 | 25 |
| Over 10 years | **2 600** | **13 000** |
| One-off backfill of pre-existing history | +1 000 | +3 000 |
| **Total** | **~3 600** | **~16 000** |

**Decision**: design for **10⁴ records**, verify headroom to 5 × 10⁴.

**What would falsify this**: a team that records far more liberally than FR-005 intends, or
per-file rather than per-decision granularity. Both push toward 10⁵, where §3's measurements say
a naive scan stops being comfortable. The mitigation is not an index up front — it is §8's
measured revisit trigger.

**Honest limitation**: the repository on hand (`bench/fixtures/oss/hono`) is a shallow clone with
a single commit, so it could not supply a real commit-volume baseline. This repository has 25
commits. Neither is a 10-year history.

## 3. `why` latency at that volume — **measured**

**Question**: can a flat, file-per-record store answer `why` fast enough with no index, no daemon
and no network?

**Method**: generated synthetic corpora of realistic records (YAML front matter with `id`, `kind`,
`provenance`, `date`, `summary`, two `paths`, `supersedes`, `commits`, plus a ~250-byte body) in a
flat directory. Measured a full scan that reads every file, parses the front matter with
`Bun.YAML`, filters on a path, and sorts by ID. Bun 1.4.0, Linux, warm cache, one warm-up pass
discarded. Harness kept at `specs/001-continuous-project-knowledge/` scratch — reproducible from
the description above.

| Records | readdir | Full scan, hand-rolled parse | Full scan, `Bun.YAML` |
|---|---|---|---|
| 1 000 | 0.2 ms | 6.5 ms | **16 ms** |
| 10 000 | 2.7 ms | 64 ms | **153 ms** |
| 50 000 | 14.4 ms | 323 ms | **780 ms** |

Linear in record count, ~15 µs per record with real YAML parsing.

**Decision**: **no index in v1.** At the §2 design volume of 10⁴, `why` costs ~153 ms — inside the
200 ms target, with no daemon, no network and nothing derived on disk.

**Negative result worth recording**: reading only the first 512 bytes of each file to skip the
body was **slower** (175 ms vs 153 ms at 10k), because the extra `open`/`read`/`close` syscalls
cost more than reading a small file whole. The obvious optimisation is a pessimisation at this
size; do not implement it.

## 4. Runtime dependencies — **measured**

The constitution forbids a new runtime dependency without a decision record. Rather than assume
what Bun provides, it was probed on Bun 1.4.0:

| Capability | Needed for | Result |
|---|---|---|
| `Bun.YAML.parse` | record front matter | **present** — parsed nested maps and sequences correctly |
| `Bun.Glob` | module and `formerly` path globs | **present** — `src/**/*.ts` matched `src/util/bin.ts` |
| `Bun.TOML` | (alternative format) | present, unused |
| `Bun.$` | invoking git | present |
| `crypto.getRandomValues` | ULID entropy | present |

**Decision**: the MVP adds **zero runtime dependencies**. No decision record is required because
nothing is being added. This also keeps FR-021 (works offline) trivially true — there is no
install step that could need a network.

## 5. Identifier scheme — **decision**

FR-029 requires identifiers that are collision-free without coordination **and** sortable by
creation time. These are jointly, not severally, required.

| Candidate | Collision-free | Time-sortable | Verdict |
|---|---|---|---|
| Sequential counter | no — two branches both take `0042` | yes | **prohibited by FR-029** |
| `crypto.randomUUID()` (v4) | yes | **no** | rejected — loses FR-027a's free ordering |
| UUIDv7 | yes | yes | viable; 36 chars with dashes |
| **ULID** | yes (80 bits entropy) | yes | **chosen** |

**Decision**: **ULID, monotonic variant**, implemented in `src/knowledge/id.ts` (~25 lines over
`crypto.getRandomValues`), not taken as a dependency. The monotonic requirement was added after
reading cairnkeep (§1): plain ULID orders same-millisecond records by random bits rather than by
creation order, which is deterministic but not chronological — and FR-027a orders by identifier.

**Rationale**: 26 characters, Crockford base32, filename-safe, and — the property that matters —
**plain lexicographic string sort equals chronological sort**. FR-027a orders records by
identifier; with ULID that is `Array.sort()` with no date parsing and no tie-break table, which is
what makes FR-032's byte-identical rendering easy rather than delicate.

**Verified, not assumed** (Bun 1.4.0, prototype generator over `crypto.getRandomValues`):

| Property | Result |
|---|---|
| Crockford base32 charset (no I, L, O, U) | pass |
| Lexicographic sort == chronological sort, across timestamps a year apart | **pass** — this is the load-bearing claim |
| An ID at `t+1 ms` sorts after one at `t` | pass |
| 200 000 IDs generated at a **single** timestamp | **0 collisions** — this is the concurrent-branch case FR-029 cares about |

**Caveat, recorded because the probe exposed it.** The prototype emitted 20 characters, not the
canonical 26: it derived only 10 base32 characters (50 bits) of randomness from 10 bytes instead
of the canonical 16 characters (80 bits). The ordering properties above are independent of
entropy width and stand; the collision result was obtained at the *weaker* 50 bits and still
showed none, so 80 bits is strictly safer. **The shipped implementation must emit canonical
26-character ULIDs (48-bit timestamp + 80-bit randomness)** — a task, not an assumption, and the
kind of detail that would have shipped silently had the claim not been probed.

## 6. Secret scanning — **decision**

FR-035 requires capture to refuse on a secret match, using deterministic offline patterns.

**Decision**: a small, versioned pattern set in `src/knowledge/secrets.ts` — high-signal shapes
only (private key headers, AWS-style key ids, bearer/authorization assignments, `*_API_KEY=`
assignments, long high-entropy strings in obvious key positions). Regex only: no model, no
network, no entropy heuristic that fires on base64 data.

**Rationale for refusing rather than warning**: automatic capture (FR-003/FR-004) runs without a
human in the loop, and the git extension's auto-commit hooks may commit the result before anyone
reviews it. Between a false positive that blocks one capture and a false negative that commits a
credential, the false positive is cheap and recoverable.

**Accepted limitation**: a pattern set will miss novel secret shapes. It reduces the likeliest
path in, it does not close the class — which is exactly why FR-033's redaction exists downstream
and why redaction output insists the credential still be rotated.

## 7. Store location and naming — **decision**

**Decision**: `.knowledge/` for the store; no global binary name claimed in v1; commands run as
`bun run knowledge <cmd>`.

**Rationale**: the project's name is unsettled — the GitHub repository was renamed to `cairn` on
2026-09-21, then the name was found to be heavily contested. **Verified while reviewing prior art
(§1): npm returns 123 packages matching `cairn`, at least six of them unrelated AI-agent
context/memory tools** (`@isaacriehm/cairn`, `@eventually-consistent/cairn`, `@principled/cairn`,
`@pairtrace/cairn`, `cairn-memory`, and others), and all three prior-art projects reviewed in §1
are themselves called some form of "cairn". The in-repo rename is deferred to its own spec. A store directory is expensive to rename once real records reference it and once other
repositories have adopted the convention, so it should not encode a name that may not survive.
`.knowledge/` describes what it holds and survives any rename.

## 8. Index — **decision, with a measured trigger**

**Decision**: no index in v1. Revisit at **~25 000 records** (≈400 ms by §3's linear fit).

**Rationale**: an index is a derived artefact. Committing one reintroduces exactly the drift that
making the view a projection was designed to remove (FR-027, FR-040); not committing one means
rebuilding it per invocation, which at these volumes costs more than the scan it replaces. The
measurement says the naive path is adequate for the design volume, so the complexity is not yet
earned.

## 9. YAML scalar hazards — **measured on Bun 1.4.0**

**Question**: is it safe to write record front matter with unquoted scalars?

**Method**: parsed single-key documents with `Bun.YAML.parse` on Bun 1.4.0 and inspected the
resulting JavaScript type. Re-run of a check first made on 1.3.13; the failures persist.

| Input | Parses as | Consequence |
|---|---|---|
| `commits: 0123456` | number `123456` | **silent corruption** — the leading zero is gone |
| `commits: 6e40653` | **`Infinity`** | **silent total loss** — serialises back as `null`; the SHA is gone |
| `commits: 1e10` | number `10000000000` | exponent form, silently evaluated |
| `commits: 0e12345` | number `0` | exponent form collapsing to zero |
| `mode: 0755` | number `755` | same class |
| `summary: #42 fixed` | `null` | **silent total loss** — `#` opens a comment |
| `summary: why this: matters` | parse error | loud, but summaries are free text and will contain `": "` |
| `commits: 7c000ac` | string | safe only because a letter is present |
| `date: 2026-09-21` | string | safe on 1.4.0; was a concern on earlier versions |
| all of the above, double-quoted | string, verbatim | safe |

**Derived**: two independent hazards affect a 7-character hex SHA.

| Hazard | Probability | Arithmetic |
|---|---|---|
| all-digit (`0123456`) | 3.73% | (10/16)⁷ |
| exponent form (`6e40653`) | 1.86% | 5 × (1/16) × (10/16)⁶ — one `e`, not first or last, the rest decimal |
| **combined** | **5.59%** | |

So **roughly one 7-character SHA in eighteen** is destroyed by being written unquoted, and the
exponent case is the worse of the two: an all-digit SHA at least survives as a wrong number, while
`6e40653` becomes `Infinity` and serialises back as `null`. At 6 characters the all-digit case
alone is 5.96%.

**Decision**: a canonical writer that double-quotes **every** string scalar, with type validation
after parsing and a byte-identical round-trip enforced by `lint` (data-model §2.8). The two silent
failures are what make this non-negotiable: a parse error announces itself, a `null` summary and a
truncated SHA do not.

**Note**: `Bun.YAML.stringify` exists but is not used for writing — its output is not a stability
contract, and the quote-everything rule is stricter than a general serialiser emits.

## 10. Unmeasured — carried as risk, not as estimate

| Unknown | Why it matters | Task |
|---|---|---|
| `git log --follow` cost on a repository with 10⁴–10⁵ commits | `why` calls it per query (FR-038); if it dominates, §3's budget is wrong and the answer is caching git output per invocation, not indexing records | Measure on a large public repository before the US2 increment closes |
| `git log --grep` for trailers at that history size | same path, same risk | Same task |
| `PostToolUse(Read)` hook latency budget in Claude Code | a slow hook degrades every file read, and §5 of contracts/hooks.md commits to failing open | Measure once the hook exists |

Measured here only that both git operations cost ~1 ms on this 25-commit repository — too small to
extrapolate from, and recorded so no one mistakes it for a result.
