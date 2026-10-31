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

> **Superseded 2026-10-31 by §12.** The accept gate is now adopted, as an inbox and an explicit
> `accept`. The reasoning below is kept as it was written, per Principle IV; §12 says what changed
> and why.

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

> *Note 2026-10-31.* This feature removes those two tools and replaces them with seven
> (contracts/cli.md, MCP server). The caution still holds and is applied as a rule rather than a
> count: every MCP tool is a view of exactly one CLI command, generated from the same command
> definition, so the surface cannot grow anything the CLI does not already have and test.

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

## 7. Naming and store location — **decided 2026-09-21**

**Decision**: project and package **`enouement`**; CLI binary **`enou`**; spec-kit extension id
**`enouement`**; knowledge store stays at **`.knowledge/`**.

| Candidate | Verdict |
|---|---|
| `eco-mcp` | **rejected** — the product is no longer an MCP server; the name describes what it stopped being |
| `cairn` | **rejected** — heavily contested: 123 npm packages match `cairn`, at least six of them unrelated AI-agent context/memory tools, and **all three prior-art projects reviewed in §1 are themselves called some form of "cairn"** |
| `eco-harness` | **rejected** by the owner |
| **`enouement`** | **chosen** — an obscure coinage, unclaimed on npm on 2026-09-21 |

**Binary `enou`**: `eno`, `enm`, `enow` and `nou` are all taken on npm, so the short forms were
not available. `enou` was.

**Both names must be re-checked immediately before the first publish**, and a placeholder MUST
NOT be published to reserve them — squatting a name to hold it is the kind of thing this project
would have to explain later.

**Scope of the rename** — split by surface, not frozen:

- **New surface from this spec uses the final names immediately**: CLI `enou <cmd>`, new
  environment variables `ENOU_*`, new log prefix `[enou]`, extension id `enouement`.
- **Legacy identifiers wait for spec 002**: `package.json` name and the `eco-mcp` bin, `ECO_*`
  variables in `bench/`, the MCP server name, the `[eco-mcp]` prefix, and existing prose.
- **`.knowledge/` stays.** It was deliberately named for what it holds rather than for the
  project, and it has now survived two renames without a migration.

**Extension id — collision check (read-only, run 2026-09-21)**: `specify extension search
knowledge` returned **7 keyword matches** (Dotdog, SpecKit Grill Me, Learning Extension, OKF
Knowledge Bundle Generator, Onboard, LLM Wiki, Work IQ) — **none named `knowledge`**. But the
command surfaces display names, not ids, and offers no `--json`, so the id itself could not be
proven free. Inconclusive, so the id is **`enouement`**, which returns no matches at all.

**Dogfooding locally — verified, not assumed**: `bun link` symlinks a `package.json` `bin` entry
into `~/.bun/bin/` (already on PATH) and executes a TypeScript entry point directly via its
shebang. So this repo gains an `enou` bin entry **alongside** the legacy `eco-mcp` one, and a
single `bun link` puts `enou` on PATH. `bun run knowledge` is this repo's **dev alias only** — it
does not resolve anywhere else, so nothing that runs in a consumer repo may use it.

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
| `commits: b4563b3` | string | safe only because a letter is present |
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

## 10. `PostToolUse` → `additionalContext` — **measured on Claude Code 2.1.270**

**Question**: does a `PostToolUse` hook's `hookSpecificOutput.additionalContext` actually reach
the model? The documentation describes that field for `UserPromptSubmit`, and it could not be
confirmed as documented for `PostToolUse`; issue anthropics/claude-code#24788 reports it not
surfacing (citing #18427 for all tools). US3's entire delivery mechanism depends on it, so docs
were not treated as behaviour.

**Method**: `claude --version` → **2.1.270**. In a **throwaway repository** (not this one), a
`.claude/settings.local.json` `PostToolUse` hook with matcher `Read` printed

```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"ENOU-PROBE-<nonce>: the codeword is heliotrope"}}
```

A session then read a file and was asked whether a codeword was present in its context. The
session's transcript JSONL was also grepped for the nonce.

**Outcome: it surfaces.**

- The model answered **"heliotrope"**, quoted the nonce verbatim, and identified it unprompted as
  *"a PostToolUse hook message appended to the Read result"* — so it arrives attached to the tool
  result, not as a separate turn.
- The nonce appears **3 times** in the transcript JSONL, including in the recorded hook
  `stdout`.

**Conclusion**: the US3 delivery mechanism is viable on 2.1.270. Two caveats that follow from the
method rather than weakening the result:

- This is one version on one machine. The behaviour is **undocumented for `PostToolUse`**, so it
  is not a contract — it can change without a changelog entry. Re-run this probe when the delivery
  hook is built (T046 gates on it) and if hook behaviour ever looks wrong after an upgrade.
- The probe measured *arrival*, not *budget*. It says nothing about the latency cost of returning
  a large `additionalContext` on every read, which §3's tiering exists to control.

## 11. Unmeasured — carried as risk, not as estimate

| Unknown | Why it matters | Task |
|---|---|---|
| `git log --follow` cost on a repository with 10⁴–10⁵ commits | `why` calls it per query (FR-038); if it dominates, §3's budget is wrong and the answer is caching git output per invocation, not indexing records | Measure on a large public repository before the US2 increment closes |
| `git log --grep` for trailers at that history size | same path, same risk | Same task |
| `PostToolUse(Read)` hook latency budget in Claude Code | a slow hook degrades every file read, and §5 of contracts/hooks.md commits to failing open | Measure once the hook exists |

Measured here only that both git operations cost ~1 ms on this 25-commit repository — too small to
extrapolate from, and recorded so no one mistakes it for a result.

*Added 2026-10-31:*

| Unknown | Why it matters | Task |
|---|---|---|
| Literal definition search (§15) on a repository of 10⁴–10⁵ tracked files | `why <symbol>` runs it per query when no record declares the symbol | **T039c**, with a committed harness, before the US2 increment closes |
| `brief` latency over many paths | it runs `why` per path plus module views; it must stay usable from a spec-kit hook | **T055h**, once `brief` exists |
| Whether any CPU-only embedding setup gives identical top-k across x86 and ARM | the precondition for even studying a dense arm under FR-032 (§14) | Only if §14's study is ever run |

### `brief` latency — **measured 2026-10-31 (T055h)**

**Method**: `bench/src/knowledge/brief-latency.ts` builds a synthetic repository in a temp directory —
10 000 records (five per source file) over 20 declared modules and 2 000 source files, all committed
to git — and times `enou brief` in-process through the CLI's own `main()` (store load, module
resolution, git rename history, `Knowledge-Record:` trailers, implementing commits; process start-up
excluded). One warm-up run discarded, 15 timed runs per size; with 15 runs, p95 is close to the
maximum. A second pass runs the same brief with git skipped, to attribute the cost.
**Machine**: Intel Core i7-11800H × 16, Linux 7.2.9, Bun 1.4.2.

| Paths | `enou brief` p50 / p95 | git skipped p50 / p95 |
|---|---|---|
| 1 | 224 / 241 ms | 186 / 206 ms |
| 10 | 640 / 804 ms | 442 / 523 ms |
| 100 | 4 460 / 5 980 ms | 1 149 / 1 325 ms |

**Reading**: one path is dominated by loading the store — consistent with §3's 153 ms scan at 10⁴. The
growth with path count is the per-path work: `whyPath` rebuilds the trust view for every path and
spawns git per path (rename history, trailers) and per matched record (implementing commit), which
is about three quarters of the cost at 100 paths. A brief over the handful of paths a feature
touches stays under a second; one over 100 paths does not. **Not yet done**, and the measured next
steps if it matters: build the trust view once per brief rather than once per path, and resolve
implementing commits for all matched records with one `git log --diff-filter=A --name-only` over
`.knowledge/` instead of one call per record. Re-run this harness to measure either.

## 12. The accept gate — **decision, 2026-10-31**

**What changed.** §1 recorded that all three prior-art projects put a human accept step between
extraction and durable storage, and argued that a committed store made the PR diff that gate. Two
things undo the argument for the people this tool is for (§16):

- **A solo developer usually has no PR.** §1 named this hole and pointed at the local `lint` hook
  to cover it; but `lint` can check form, not whether anyone *read* an agent's record.
- **A diff is not a reading.** A feature's capture can write several records at once into a large
  diff; approving the PR approves them whether or not anyone read them. Merge is a gate on the
  change as a whole, not on each piece of knowledge in it.

**Decision**: every capture path writes a **draft** to `.knowledge/inbox/`; a person turns a draft
into a record with `enou accept`, which validates it again and moves it to `.knowledge/records/`
under the same identifier. Reads ignore drafts. The MCP server offers no acceptance; the
documented Claude Code setup denies `enou accept`, `enou reject` and `enou redact` to the agent.

**Rejected alternatives**

| Alternative | Why not |
|---|---|
| Keep the PR as the gate (status quo) | no gate at all for a solo developer pushing to `main`; a merged PR approves every record in it unread |
| Store an approval in the record (`approved_by`, `approved_at`, a status) | a second mutable source of trust next to the file's location; an agent can type it into its own draft; and it makes acceptance an *edit* of a supposedly immutable record — two exceptions to FR-007 instead of one |
| Approval recorded as a commit trailer by someone other than the author | meaningless with one person; trailers are already shown (formats §3) to be fragile under squash merges |
| A gitignored staging area | drafts never reach a teammate's review, and a draft written by one machine's agent is invisible on another — the opposite of FR-019 |

**Why the location is the right carrier.** It is visible in every diff as a move, it needs no field
in the record, and it costs no exception to immutability: a draft was never a record, so editing
or deleting it does not touch Principle IV, and from the moment it is a record nothing about it
changes except by redaction.

**What it does not stop**: an agent with a shell that is not under a deny rule, or a person who
moves files by hand. Both are visible as moves in the diff. The gate is meant to stop knowledge
being trusted *without anyone choosing to*, not to resist someone determined.

## 13. `recall` — **what has to be true before it ships**

`recall` stays a refusing stub in v1 (FR-049). This section fixes, ahead of time, what the
experiment in `bench/` must look like, so the bar cannot be set after the results are seen.

**The protocol** (all of it registered before a ranker exists):

1. A judged query set written **before** the ranker, committed as a hash first in the same way as
   tasks.md T019a, and revealed after the ranker is frozen.
2. It MUST include queries with **no** relevant record, and queries whose wording shares no
   content word with the relevant record (the "word-mismatch slice"). A set where every query
   repeats its record's title measures string matching and nothing else.
3. Measures: Recall@5 and MRR on answerable queries; the share of no-relevant-record queries
   answered "no match"; each reported as *k/N*, and the two kinds never merged into one figure.
4. Thresholds for all three are written into the protocol file before the ranker is built.
5. Where a public issue tracker is used as an outside corpus, each query sees only items resolved
   before it was created, so document statistics never see the future.

**Design constraints the ranker must meet** — each is *derived*, from the structure of BM25 and of
the records, not measured here:

- **Explainable.** Every score decomposes into `{term, field, tf, idf, contribution}` entries that
  sum to it. A score nobody can explain is a score nobody can debug.
- **Fields that carry meaning.** Title/summary, `paths`, module and kind as their own boosted
  fields (borrowing the "prefix the chunk with its path and context" idea of §14 for keyword
  search); the body as content only — Markdown headings shared by every record would otherwise
  match every query that uses their words.
- **Rank, then abstain, as two decisions.** A minimum-match rule counted over the *whole* query
  scales with query length: a long, natural question then requires dozens of shared terms and
  excludes the record it is about. Ranking should rank; whether to answer at all is a separate rule
  — for example, a minimum number of matched rare terms, or the top score relative to the query's
  score against itself — measured on the no-match queries, not assumed.
- **Trust before statistics.** Document frequencies and lengths come from accepted current records
  only; drafts and superseded records never shape the scores of what is shown.
- **Deterministic.** Ties broken by identifier.

**Implementation note**: Bun's built-in SQLite has FTS5 with `bm25()` (cited from the research
probe of 2026-10-31; platform coverage unverified). It is not needed at the 10⁴ design volume, and it
does not return per-term contributions, so it does not meet the first constraint on its own.

## 14. Dense and approximate retrieval (LEANN) — **cited, rejected for the product**

**What it is** (cited: arXiv 2506.08276; source read at github.com/StarTrail-org/LEANN, commit
07796bd, 2026-10-29): a graph vector index that stores the graph and compressed codes, drops the
embeddings, and recomputes embeddings for the nodes a query visits. The paper's case is storage at
10⁶–10⁸ chunks: 4 GB against 188 GB for HNSW on its 60M-chunk corpus, at retrieval latencies of
about 1–7 s per query on a desktop GPU (cited, paper Tables 1–2).

**Why it does not fit** — each point is about this product's constraints, not the paper's quality:

- **Wrong problem.** It saves storage at a scale two to four orders of magnitude above the 10⁴
  records of §2. At 10⁴, exact search over full vectors is small and needs no approximation
  (derived).
- **Breaks FR-021, FR-032 and Operating Constraints.** It adds a Python and PyTorch runtime with a
  native build; its default embedding model depends on the hardware it runs on and falls back to
  downloading it (network); GPU settings in the source are non-deterministic; it runs a background
  embedding server (cited, source). None of that can produce byte-identical output on every machine.
- **No natural "no match".** Similarity search always returns neighbours, while a keyword ranker
  with zero shared terms scores zero (derived). Principle II needs the abstention signal.
- **Its coding-agent comparison is not against keyword search.** The repository's agent benchmark
  compares against the agent's own tools with LEANN absent, not against a BM25 arm (cited, source
  of the benchmark scripts), so it does not answer the question this section would need answered.

**Kept as ideas**: put a record's paths and module into keyword fields (§13); if ranks are ever
fused, use reciprocal rank fusion or normalised scores — never a raw weighted sum of differently
scaled scores, which is what its hybrid mode does (cited, source).

**If the semantic question is ever studied**: an *exact* dense arm in `bench/`, judged on §13's
word-mismatch slice and its no-match queries, plus a cross-machine determinism check (§11). It
earns a decision record only by winning on mismatch without losing abstention, and even then it
ships opt-in and labelled (Principle VI).

## 15. Code-graph tools (codegraph) — **cited, not adopted; one idea borrowed**

**What was considered** (cited: github.com/colbymchenry/codegraph, the most-starred project of that
name and the one built for coding agents; source read at v1.6.2): tree-sitter parsing to a SQLite
graph of definitions and call edges, served over MCP. Relevant facts from its source and docs:

- its index is derived and kept in `.codegraph/`, which ignores itself (`.gitignore` containing
  `*`) so it can never be committed — a pattern worth copying for any cache this project adds;
- its own drift study reports that an incrementally synced index had about 4% wrong call edges
  while definitions matched a rebuild exactly (cited, its `docs/benchmarks`);
- telemetry and an update check are on by default (cited, source), which no path of this product
  may depend on (Operating Constraints);
- its MCP instructions tell the agent to read code through its tools **instead of `Read`** (cited,
  source) — the coexistence risk recorded in contracts/hooks.md §3.

**Decision**: no dependency. What `why` needs is symbol → defining file, which is the reliable part
of such a graph and needs no graph: a literal definition search with `git grep` over the tracked
files (FR-047). It works at any revision without a checkout, leaves nothing to go stale, and adds
no dependency. Its failure mode is a missing answer — a nested member it cannot see — never a wrong
one, and an ambiguous name is listed rather than resolved.

**Borrowed**: exact match or nothing, with ambiguity reported (its symbol lookup behaves this way);
and the rebuild-against-rebuild check as the method for testing FR-032's byte-identical
projection — compare sets, with a second clean render as the control.

**Not yet measured**: the search's cost at scale (§11). One run of a scratch probe on a 1,277-file
TypeScript repository answered in well under a second per symbol. Its harness is not committed, so
under Principle I it is **not a result** and supports no claim here; it only motivated task T039c,
which measures the search with a committed harness.

## 16. Audience — **decision, 2026-10-31**

**Decision**: this tool is for solo developers, small startup teams and solo builders.

**Consequences, each carried into the spec**: no rule presumes a second person (spec.md,
Assumptions); acceptance is something one person does for their own agent's drafts (§12); no
ticket-tracker import, estimate, cycle time or forecast (spec.md, Out of Scope); the vocabulary
stays the repository's own — modules, paths, records, specs, commits, pull requests.
