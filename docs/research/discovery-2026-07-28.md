> Historical — describes the pre-2026-09-21 gateway scope.

# eco-mcp — discovery pass for repositioning

**Date:** 2026-07-28 · **Branch:** `feat/eco-mcp-gateway-v0` @ `4499754` · **Mode:** read-only, no code modified.
**Frame:** the reader is a developer running Claude Opus 5 on a flat-rate Max subscription inside
Claude Code. Token cost ≈ irrelevant. Native Grep/Glob/Read are strong. The only question that
matters is *"would this developer call this tool instead of the native one, and why."*

Everything below is measured on this machine today, or cited to `file:line`. The README is treated
as a claim; the code and the running server are the evidence.

---

## Verdict up front

Three findings dominate, in order of how much they should change the plan.

1. **The headline benchmark numbers survive re-running but do not survive re-asking.** 97% and 78%
   reproduce exactly. But they come from giving grep a bare word (`cors`) and giving the code graph
   an anchored regex (`^cors$`) — two different questions. Ask ripgrep the question the graph was
   asked and it costs **132 tokens against the graph's 260**. The graph is 2× *worse*, not 78% better.
   §1.

2. **Two of the seven tools are actively broken and return confident wrong answers.** `find_concept`
   returns byte-identical results for *"verify a JSON web token"* and *"pretty pink fluffy unicorns
   dancing on rainbows"* — the underlying binary silently ignores the parameter. `run_command` turned
   `cat package.json` into the string **"all checks passed (no failures)"**. Both proven live. §2, §6.

3. **The code graph never refreshes.** It indexes once per server process, then serves a frozen
   snapshot for the rest of the session. Code the agent writes mid-session is invisible; code the
   agent deletes is still reported as present — proven in §6. For a daily driver inside Claude Code,
   where the agent edits constantly, this is disqualifying and it is the *whole* argument against
   the tool. The backend handles re-indexing fine (11 ms warm on 284 files) — the bug is one cached
   Map in the wrapper.

Under the new framing, the honest reading is: **the token thesis was the load-bearing wall, and it
does not hold up.** What is left standing is one idea that never depended on it — Context Packs — and
it is the least-built part of the repo.

---

## 1. Claim audit

### 1.1 The benchmark reproduces exactly

`cd bench && bun run src/microbench.ts`, run today, exit 0, verbatim:

```
# Retrieval & Compression Lever Micro-benchmark (hono, deterministic)

Backends: semantic=semble, structural=codebase-memory
Tokens via gpt-tokenizer (cl100k; approximate for Gemini/Claude). No LLM calls.
grep = scoped to src/, word-boundary, head-capped 60 lines (realistic). retrieve = semble's actual top-k chunks.

## Per query — tokens injected to answer

| Query | grep-only (locate) | grep+read whole file (comprehension) | retrieve chunks (semble) | query_structure (cbm) |
|---|---|---|---|---|
| cors | 144 | 1407 | 1428 | 36 |
| jwt | 457 | 1737 | 1235 | 109 |
| basic-auth | 69 | 1198 | 1284 | 45 |
| get-cookie | 326 | 1444 | 1397 | 41 |
| regexp-router | 211 | 2146 | 847 | 29 |

## Totals across 5 queries (real tokens)

| Approach | Tokens | vs grep+read | vs grep-only |
|---|---|---|---|
| grep-only (locate) | 1207 | 85% | 0% |
| grep + read whole file (comprehension) | 7932 | 0% | — |
| retrieve chunks (semble) | 6191 | **22%** | -413% |
| query_structure (codebase-memory) | 260 | **97%** | 78% |

**Honest reading:**
- vs reading whole files (comprehension): retrieve −22%, structural −97% — the real win, since both sides can actually answer (retrieve returns the live chunk content, not a locator).
- vs scoped grep (location only): retrieve −-413% — grep is already compact for plain location; the gateway's edge there is smaller. Stated honestly.

## Test-output compression lever (sample-app)

> Single failing-test sample — small absolute size, illustrative not representative.
| Output | bytes | tokens |
|---|---|---|
| raw `bun test` | 681 | 222 |
| failures-only compressed | 331 | 111 |

Reduction: **51%** (bytes) on this test. Filter keeps Expected AND Received lines (diagnostic-preserving).
```

Every number in `docs/research/benchmark-results.md` §1 matches to the digit. **The harness is
reproducible and the docs did not fudge the arithmetic.** Credit where due — this is better than most
projects manage. The problem is upstream of the arithmetic.

(Cosmetic bug: `-413%` and `−-413%` at `bench/src/microbench.ts:116` and `:121` — `pct()` at `:109`
returns a negative string that the prose then prefixes with another minus sign.)

### 1.2 The exact "scoped grep" baseline — there is no grep

There is no `grep` invocation anywhere in the harness. The baseline is a hand-rolled JavaScript
scanner. `bench/src/microbench.ts:43-55`, verbatim:

```ts
// Realistic grep: word-boundary match, src only, capped head (what an agent's grep tool returns).
function grepTokens(keyword: string): number {
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const hits: string[] = [];
  for (const f of srcFiles(HONO)) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (re.test(l) && hits.length < GREP_LINE_CAP) hits.push(`${relative(HONO, f)}:${i + 1}: ${l}`);
    });
    if (hits.length >= GREP_LINE_CAP) break;
  }
  return tok(hits.join("\n"));
}
```

Scope comes from `srcFiles()` at `:27-41` (walks `<root>/src` only, `.ts/.tsx/.js/.jsx`, excludes
`*.test.*`/`*.spec.*`). Cap is `GREP_LINE_CAP = 60` at `:25`.

### 1.3 The exact "grep + read whole file" baseline

`bench/src/microbench.ts:95-97`:

```ts
    const grep = grepTokens(q.keyword);
    const file = readFileTokens(q.target);
    const grepRead = grep + file;
```

with `readFileTokens` at `:57-60` reading the **entire** file, and `q.target` a hardcoded path in the
`QUERIES` table at `:70-76`.

### 1.4 Are 97% and 78% computed the way the docs describe? Arithmetically yes. Semantically no.

Three defects, in ascending order of severity.

**(a) The two sides are asked different questions.** Same loop, `bench/src/microbench.ts:95` and `:99`:

```ts
    const grep = grepTokens(q.keyword);                                    // "cors"
    ...
    const struct = backends.structural ? tok(backends.structural.search(q.pattern, HONO)) : 0;  // "^cors$"
```

`q.keyword` is a bare word matching every *usage*. `q.pattern` is an anchored regex matching only the
*definition* (`microbench.ts:71-75`). The 1,207-token grep baseline is almost entirely the cost of
answering a broader question.

**(b) The locator-vs-document rig the audit says it removed is still live — on the side the headline
comes from.** `bench/src/agent/backends.ts:35-41` states the fix in its own words:

```
   * Semantic search → top-K retrieved chunks (location + the ACTUAL chunk content semble
   * surfaces). This is the real retrieved context a production MCP would inject — NOT a
   * one-line signature. Returning the real chunk keeps the benchmark a fair whole-file-vs-chunk
   * comparison (the audit flagged the old signature-only version as a rigged locator-vs-document
   * comparison). Each chunk is capped to avoid a pathological huge chunk dominating.
```

That fix was applied to semble only. Twenty lines below, `CodebaseMemoryBackend.search`
(`bench/src/agent/backends.ts:96-108`) is still exactly signature-only:

```ts
      .map(
        (r: any) =>
          `${r.name} (${r.label}) ${r.file_path}${r.signature ?? ""}${r.return_type ?? ""}` +
          (r.in_degree || r.out_degree ? ` [in:${r.in_degree} out:${r.out_degree}]` : ""),
      )
```

The full 36-token structural "answer" for the `cors` query, pulled from the binary today:

```
cors (Folder) src/middleware/cors
cors (Function) src/middleware/cors/index.ts(options?: CORSOptions): MiddlewareHandler [in:2 out:3]
```

It is compared against 1,407 tokens that include all 157 lines / 5,043 bytes of
`src/middleware/cors/index.ts`. That is a locator measured against a document — the precise thing
`benchmark-results.md:5-6` says was "an artifact of a rigged locator-vs-document comparison ... now
fixed." It was fixed for semble, which is why semble's number fell to 22%, and left in place for
structural, which is why structural's number stayed at 97%. **The 97% is the survivor of the bug the
audit was run to kill.**

**(c) Counter-measurement.** Asking plain ripgrep the *same* question the graph is asked
(`rg -n --glob '!*.test.*' 'export (const|function|class) cors\b' src/`), across all five queries:

| Approach | Tokens, 5 queries | Source |
|---|---|---|
| **ripgrep, definition-scoped** | **132** | measured today |
| structural graph (`^anchored`) | 260 | microbench |
| microbench "scoped grep" (bare word) | 1,207 | microbench |

Against a like-for-like locator query, **the code graph costs 2× what ripgrep costs.** The 78%
"win over scoped grep" inverts to roughly −97%.

And the comprehension baseline is inflated the same way. An agent reading a definition does not read
the whole file; it greps with context. `rg -A 25` on the same five definitions:

| Approach | Tokens, 5 queries |
|---|---|
| **ripgrep `-A 25` (definition + body)** | **2,723** |
| microbench "grep + read whole file" | 7,932 |

The 7,932-token baseline is ~3× what a competent agent actually spends. Claude Code's `Read` also
takes `offset`/`limit`, and its `Grep` has `-A/-B/-C` and `output_mode`, so the modelled behaviour is
not the tool's behaviour.

**Conclusion on Q1:** the arithmetic is honest, the harness is reproducible, and the conclusion is
still wrong. Against a caller who greps competently — which Claude Code does by default — structural
retrieval is a token *loss*.

### 1.5 Two further claim defects

**The 51% compression figure does not come from the shipped compressor.** The microbench inlines its
own filter at `bench/src/microbench.ts:128-131`:

```ts
  const compressed = raw
    .split("\n")
    .filter((l) => /(fail|error|expect|received|throw|✗|✘|\d+ pass|\d+ fail|cannot find|TypeError|ReferenceError)/i.test(l))
    .join("\n");
```

The shipped product uses a different regex at `src/util/compress.ts:4-5` (adds `assert`, `panic`,
`SyntaxError`, stack-frame patterns) plus a `clamp()` the benchmark has no equivalent of. There is a
*third* copy at `bench/src/agent/tools.ts:164-172` with yet another regex (it includes a bare
`\bnot\b`). Three implementations, three behaviours, and the published number measures none of the
shipped one.

**The benchmarked configuration is not the shipped configuration.**

| | benchmarked | shipped |
|---|---|---|
| structural `k` | 10 — `bench/src/agent/backends.ts:96` | 15 — `src/backends/structural.ts:35` |
| semantic `k` | 5 — `bench/src/agent/backends.ts:42` | 3 — `src/backends/semantic.ts:16` |
| semantic chunk cap | 1200 chars — same line | 600 chars — same line |

`README.md:14` attaches "**~97% fewer tokens** vs grep+read, measured" to the `search_structure`
*tool*. That tool returns up to 15 rows; the measured backend returned up to 10. The two backend
files are near-duplicates that have drifted.

**Five of the seven shipped tools were never benchmarked at all.** `bench/src/microbench.ts` touches
only `backends.semantic.search` (`:98`) and `backends.structural.search` (`:99`). `find_concept`,
`repo_map`, `get_context`, `update_context` have no measurement of any kind — and §2 shows what got
through as a result.

---

## 2. Redundancy vs native tools

Measured baseline for comparison: `rg -n --glob '!*.test.*' "\bcors\b" src/` on hono returns the
definitive answer (`src/middleware/cors/index.ts:63: export const cors = ...`) in **18 ms**, 6 lines,
~90 tokens, and is *never stale*.

| Tool | What native already does | What is genuinely left | Verdict |
|---|---|---|---|
| `search_structure` `src/server.ts:28-47` | `Grep` with a definition pattern: 132 tok/5 queries vs the graph's 260, and always current | `in_degree`/`out_degree` — a real call-graph signal grep cannot produce. But it is 2 numbers on a line, and the wrapper throws away the richer fields the binary returns (`complexity`, `lines`, `is_exported`, `is_entry_point`, and a `bt` bag-of-identifiers) | **Keep only if rebuilt around call-graph edges.** As a symbol finder it is strictly worse than Grep, and stale on top (§6) |
| `find_concept` `src/server.ts:49-67` | — | **Nothing. It is broken.** Proven in §6.1: identical output for a JWT query and a nonsense query | **Delete today.** Not "deprioritise" — it emits confident wrong answers |
| `retrieve` `src/server.ts:69-88` | `Grep` fails on genuinely wordless queries; this is the one real gap | Works, and returns correct results (found `src/utils/jwt/jwt.ts` for "verify a JSON web token"). Costs 1,089 ms and the returned chunk is mostly imports and a licence header | **Keep.** The only tool doing something native cannot. Needs chunk-boundary work to raise signal density |
| `run_command` `src/server.ts:90-114` | `Bash`, which returns the truth | **Negative value.** It silently destroys non-test output and replaces it with a false success string (§6.2) | **Delete.** On a flat-rate plan the entire premise — pay fewer tokens for logs — is worthless, and the implementation is unsafe |
| `repo_map` `src/server.ts:118-149` | `Glob` + `Read` on entry points; Claude Code reads CLAUDE.md on its own | The idea (importance-ranked orientation) is good. The implementation does not do it: sorts on `inDeg + outDeg` (`:138`) while printing and captioning `inDeg` (`:143`, `:146`), so the live output ranks `#dispatch [refs:1]` above `#addRoute [refs:3]`. The `SKIP` set at `:134` misses `Variable`, so `jsr.json` keys leak in as `. (Variable) [refs:0]` inside a "top 20 by reference count" | **Keep the idea, rewrite the ranking.** Sort on `inDeg`, drop non-code labels, exclude private `#`-methods |
| `get_context` `src/server.ts:151-176` | Nothing — Claude Code reads CLAUDE.md but has no per-module layered convention | Real and additive | **Keep. This is the product.** |
| `update_context` `src/server.ts:178-198` | Nothing native | Real and additive, but currently a raw appender with no staleness binding, no content constraint, and no path containment (§3) | **Keep, rebuild.** |

**Would delete: `find_concept`, `run_command`. Would rebuild before shipping: `repo_map`,
`search_structure`. Would keep as-is: `retrieve`. The product is `get_context`/`update_context`.**

Worth stating plainly: five of the seven tools are justified by a token argument that §1 dissolves.
Once cost is off the table, `search_structure`, `find_concept`, `retrieve`, `run_command` and
`repo_map` have to win on *answer quality* against Grep/Read — and only `retrieve` does.

---

## 3. `update_context` / CCI — exact code path

Path: `src/server.ts:194` → `writeContextPack` (`src/util/context.ts:40-57`).
Read side: `src/server.ts:163` → `findContextPacks` (`src/util/context.ts:19-37`).

### 3.1 Whole rewrite or incremental edits? **Neither — blind append.**

`src/util/context.ts:50-55`:

```ts
  if (opts.mode === "replace" || !existsSync(dest)) {
    writeFileSync(dest, content.trim() + "\n", "utf8");
  } else {
    const prev = readFileSync(dest, "utf8").trimEnd();
    writeFileSync(dest, `${prev}\n\n---\n\n${content.trim()}\n`, "utf8");
  }
```

Two modes only: `replace` clobbers the whole file, `append` (the default, and what the tool
description tells the agent to use) concatenates a new block after a `---`. There is no merge, no
diff, no dedup, no reconciliation with what is already there. The tool never reads the existing pack
before writing to it, so the calling agent cannot revise a claim — only stack a new one on top of the
old one, including a contradicting one.

### 3.2 Staleness binding? **None whatsoever.**

```
$ grep -rniE "hash|mtime|sha|stale|digest|checksum|md5|createHash" src/
src/server.ts:158:      "module: it's the digested knowledge a teammate would give you, ..."
```

The single hit is the word "digested" inside a description string. There is no content hash, no
mtime, no commit sha, no file list, no line anchors — nothing that ties a pack to the module it
describes. A pack written against code that was deleted six months ago is served with exactly the
same confidence as one written five minutes ago, and `get_context` gives the reader no way to tell
them apart. Note that `README.md:26-30` sells this as a "living knowledge base"; nothing in the code
makes it living.

### 3.3 Constraint on what goes in the pack? **None. It can be restated source code.**

`src/server.ts:189` is the entire validation:

```ts
      content: z.string().describe("concise markdown: domain logic, decisions, edge cases, gotchas"),
```

No length cap, no schema, no format check, no code-block rejection, no similarity check against the
module's actual source. The only thing standing between the pack and a verbatim copy of the module
is the English sentence "(NOT a code dump)" in the tool description at `src/server.ts:185`. That is a
prompt, not a constraint — and it is the same class of instruction that agents routinely drift from
over a long session.

This matters more than it looks. A pack that restates source is worse than useless: it is a second
copy of the truth that ages independently of the first.

### 3.4 The 10th consecutive update of the same pack

Ten appends → one file with ten blocks separated by `---`, in write order, growing without bound.
Specifically:

- No size cap on write (`src/util/context.ts:40-57` has none).
- No size cap on read. `findContextPacks` (`:19-37`) walks from the target path up to the workspace
  root and concatenates **every** `.md` in **every** `.context/` directory it passes, joined at
  `src/server.ts:173`. A 40 KB accreted pack is injected whole.
- No dedup, so update #10 restating what update #3 said produces both.
- No ordering signal, so a reader cannot tell which block is current. With no timestamps (§3.2), if
  blocks 3 and 10 conflict there is nothing in the file that resolves it.
- Nothing prunes. The failure mode is not corruption; it is a pack that quietly becomes more
  expensive and less trustworthy than reading the module — the exact thing it exists to avoid.

The gap between "the agent's `.context` folder" and "a folder of stale contradictory notes" is
entirely unmanaged.

### 3.5 Unrequested finding — `update_context` writes outside the workspace

`src/util/context.ts:47` resolves the caller-supplied `module` with no containment check:

```ts
  const cdir = join(resolve(root, modulePath), CONTEXT_DIR);
```

`resolve()` happily accepts `../` and absolute paths. Demonstrated in a throwaway sandbox:

```
workspace declared : <temp-dir-5>/workspace
tool reported      : Context Pack updated: ../OUTSIDE-THE-WORKSPACE/.context/domain_logic.md (stage it in your PR for review).
wrote outside ws?  : YES -> <temp-dir-5>/OUTSIDE-THE-WORKSPACE/.context/domain_logic.md
content            : "escaped the declared workspace\n"

absolute module    : Context Pack updated: ../ABSOLUTE-TARGET/.context/domain_logic.md (stage it in your PR for review).
wrote at abs path? : YES
```

Note the second line: the tool reports a *relative* path while writing to an absolute one, so the
message shown to the agent misstates where the write landed. `ECO_WORKSPACE` reads as a sandbox
boundary and is not one — this is the only unconditional filesystem-write tool in the server. Fix is
a containment check in `writeContextPack` before `mkdirSync`.

---

## 4. Evolver coupling — where the synthesis model is chosen

**It is not chosen anywhere, because there is no synthesis step in the code.**

```
$ grep -rniE "anthropic|openai|api_key|apiKey|llm|gemini|claude" src/
src/server.ts:4:// Exposes token-thrifty code tools so cheap models can do real work:
src/util/context.ts:4:// them back after finishing work (reviewed in the PR). The LLM synthesis is done by the agent's
```

Both hits are comments. `src/` has no LLM client, no API key handling, and only three environment
reads total (`ECO_WORKSPACE`, `HF_HUB_OFFLINE`, `HOME` — plus `ECO_CBM_BIN`/`ECO_SEMBLE_BIN` passed
as string literals to `resolveBin`). `package.json` dependencies are `@modelcontextprotocol/sdk` and
`zod`. Nothing else.

The synthesis happens *before* the tool is called: the calling agent composes the prose and passes it
in as the `content` parameter (`src/server.ts:189`). So the answer to "is it hardcoded to the calling
agent's model" is **yes, structurally and unavoidably** — not by a config default that could be
overridden, but because the tool's input *is* the finished output of the caller's model. On the
target setup that means every Context Pack is written by Opus 5.

`README.md:30` states this honestly: *"The synthesis is done by the agent's own model — no extra API
key needed."* `SPEC.md` §2.4 specifies the opposite and was never built: *"The plugin routes the `git
diff` and the ticket details to a fast, cheap model (Haiku)."* That gap is the "evolver."

### Concrete change surface to route synthesis to a separate model

Not made. This is what it would touch:

1. **`package.json:11-14`** — add an LLM client (`@anthropic-ai/sdk`). Precedent exists in
   `bench/package.json:16-18`; `bench/src/agent/llm.ts` already implements Anthropic + OpenAI-compat
   clients with env-var selection (`:11`, `:122`) and is directly liftable.
2. **New `src/util/model.ts`** — read `ECO_SYNTH_MODEL` / `ECO_SYNTH_BASE_URL` / `ECO_SYNTH_API_KEY`,
   alongside the existing `ECO_*` convention in `src/util/bin.ts:32-34`. Absent key ⇒ fall back to
   today's pass-through behaviour, so the tool keeps working with no configuration.
3. **`src/server.ts:187-192`** — change the input schema. Today it takes finished `content`. It would
   take raw material instead: `diff` (or a git ref), `notes`, `task`. This is the breaking change and
   the real design decision — the tool stops being a file-writer and becomes a summarizer.
4. **`src/server.ts:194-197`** — insert the synthesis call between the handler and
   `writeContextPack`. Needs `async` + a timeout; note everything else in the server is
   `Bun.spawnSync`, so this would be the first genuinely async path.
5. **`src/util/context.ts:40-57`** — for synthesis to *revise* rather than *append*, the existing pack
   has to be read and passed in as prior context. That is the same change §3.1 and §3.4 need
   independently, and it is where the append-only design has to be replaced by a merge.
6. **New: staleness metadata.** Once a cheap model regenerates packs, something has to decide *when*.
   That needs the commit sha / content hash that §3.2 found is entirely absent — a frontmatter block
   in the pack plus a check in `findContextPacks`.

Items 3, 5 and 6 are a redesign of the tool, not a config flag. Item 6 is the interesting one: it is
what makes a cheap-model evolver *possible* (regenerate the packs whose modules moved), and it is
also the thing that would make Context Packs trustworthy even with no evolver at all. It is worth
building for its own sake first.

---

## 5. Tool descriptions as routing

These strings are the entire routing logic — the only thing that decides whether an agent with a
working `Grep` reaches for the tool. Verbatim from `src/server.ts`, with an assessment against a
caller whose native search is strong.

**`search_structure`** (`src/server.ts:33-35`)
> Find symbols (functions, classes, interfaces, methods) by name regex via the code graph. Token-light: returns symbol metadata (file path, signature, call degree) — NOT file contents. Use this FIRST for 'where is X defined' / 'what calls X' instead of grep + reading files.

Routes **wrongly, and aggressively.** "Use this FIRST ... instead of grep" is an unconditional
override of the correct default, sold on "Token-light" — a benefit worth nothing here, and §1.4 shows
it is false against a definition-scoped grep anyway. The one true differentiator, `what calls X`, is
buried third. Rewrite: lead with call-degree, drop the token framing, drop "FIRST", and say plainly
that for `where is X defined` grep is the better tool.

**`find_concept`** (`src/server.ts:54-56`)
> Semantic vector search over the code graph for a natural-language concept (e.g. 'where is rate limiting handled'). Returns matching symbols + locations, token-light. Use when there's no obvious literal keyword to search for.

The trigger condition is well-drawn and an agent would follow it correctly. That is the problem —
**the tool is broken** (§6.1), so good routing sends the agent straight into a wrong answer with no
signal that anything failed. Delete the tool; the description is not the issue.

**`retrieve`** (`src/server.ts:74-76`)
> Tuned semantic retrieval (semble): returns the top few relevant code chunks for a query. Prefer search_structure/find_concept for locating symbols; use this when you need to SEE the actual code for a fuzzy concept. Kept to a small k to stay token-thrifty.

**The best description in the file** — a clear positive trigger and an explicit deference rule. Two
fixes: it defers to `find_concept`, which is broken, and "token-thrifty" is the wrong sell. Say
instead that it finds code with no greppable keyword, which is true and is the actual gap.

**`run_command`** (`src/server.ts:95-97`)
> Run a shell command (tests, build, lint) in the workspace and return its output with noise stripped — failures/errors/stack traces only for test runs. Cuts the tokens an agent pays to read verbose logs. Returns a one-line savings note.

Routes **dangerously.** It reads as a general command runner ("Run a shell command"), and the
qualifier "for test runs" implies non-test commands come back intact. §6.2 proves they do not. An
agent has no reason to prefer this over `Bash` on a flat plan, and every reason to avoid it.

**`repo_map`** (`src/server.ts:123-125`)
> A token-budgeted map of the most IMPORTANT symbols in the repo, ranked by how many things reference them (call in-degree — a PageRank proxy). Read this FIRST to orient in an unfamiliar codebase instead of listing/reading files. Returns symbol + file + signature, grouped by file.

Good trigger ("unfamiliar codebase"), **but the description promises behaviour the code does not
have** — the sort is `inDeg + outDeg` (`:138`), not in-degree. The live output leads with
`#dispatch [refs:1]` over `#addRoute [refs:3]` and includes `jsr.json` keys at `[refs:0]`. An agent
that trusts "most IMPORTANT" is being misinformed.

**`get_context`** (`src/server.ts:156-159`)
> Read the module's living Context Pack(s) — distilled domain knowledge stored in .context/*.md alongside the code (business rules, gotchas, architecture). Read this BEFORE diving into a module: it's the digested knowledge a teammate would give you, at a fraction of the tokens of reading the source. Layered: module-specific first, broader context after.

**Routes correctly, and this is the one that would actually fire.** "Read this BEFORE diving into a
module" is a clean, non-competing trigger — it does not ask the agent to abandon a tool that works.
Drop the token clause; the argument is "knowledge that is not in the source," which stands on its own
and is stronger. Add a freshness marker once §3.2 is fixed, because "living" is currently unearned.

**`update_context`** (`src/server.ts:183-186`)
> Persist distilled domain knowledge to <module>/.context/domain_logic.md (Continuous Context Integration). Call this AFTER completing a task: summarize the business logic, key decisions, and gotchas you learned (NOT a code dump) so the next agent reads 1k tokens instead of the whole module. The file is staged into the PR for review. Append by default.

Clear trigger. Two flaws: the "NOT a code dump" constraint is enforced nowhere (§3.3), and "The file
is staged into the PR" is **false** — nothing in `src/` runs git. The tool tells the agent something
about the world that is not true.

**Cross-cutting.** Four of seven descriptions sell on tokens. For this user that is not a neutral
waste of words — it is an argument to switch away from a working tool in exchange for a benefit worth
zero, which makes the tool *less* likely to be called correctly, not more. Rewriting every
description around capability instead of cost is cheap and is probably the single highest-leverage
edit in the repo.

---

## 6. Fragility

### 6.1 Wrong version ⇒ silent wrong answers (live, today)

`find_concept` calls `search_graph` with a `semantic_query` key (`src/backends/structural.ts:69`).
The installed `codebase-memory-mcp 0.7.0` does not implement it, does not reject it, and returns the
**entire symbol table**:

```
--- query: "verify a JSON web token"        -> {"total":3529,"results":[{"name":"#addPath", ...
--- query: "zzzz nonsense unicorn"          -> {"total":3529,"results":[{"name":"#addPath", ...
```

Through the MCP server, three different queries return byte-identical output:

```
--- query: "verify a JSON web token" ---            --- query: "pretty pink fluffy unicorns dancing on rainbows" ---
#addPath (Method) src/router/reg-exp-router/...     #addPath (Method) src/router/reg-exp-router/...
#addRoute (Method) src/hono-base.ts...              #addRoute (Method) src/hono-base.ts...
#addWildcard (Method) ...                           #addWildcard (Method) ...
```

`find_concept` is `results.slice(0, 8)` of an unfiltered 3,529-symbol dump
(`src/backends/structural.ts:70`). It has never worked. Nothing detects this: the response is
well-formed JSON, so the `try/catch` at `:20-23` passes and the wrapper reports success. This is the
canonical version-drift failure — the schema stayed valid while the semantics vanished — and it
shipped undetected because §1.5 shows `find_concept` was never benchmarked.

### 6.2 Garbage in the compressor ⇒ silent destruction of real output

`compressOutput` decides a command is a test run by regex (`src/util/compress.ts:18`):

```ts
  const looksLikeTests = /\d+ (pass|fail)|PASS|FAIL|✓|✗|test/i.test(raw);
```

A bare `test`, case-insensitive, anywhere in the output. That matches `latest`, `greatest`, `testing`,
`contest`, and any `package.json` containing a `test` script. On a match, everything not matching the
`KEEP` regex (`:4-5`) is dropped, and if nothing matches, `:22` substitutes a sentence:

```ts
    text = kept.length ? kept.join("\n") : "all checks passed (no failures)";
```

Live, through the MCP server:

```
--- $ cat package.json ---
all checks passed (no failures)

[eco-mcp: compressed 484→31 chars, exit 0]

--- $ echo 'Downloading latest release' && echo 'ok: 3 files written' ---
all checks passed (no failures)

[eco-mcp: compressed 47→31 chars, exit 0]
```

`cat package.json` returned **"all checks passed (no failures)"**. The file contents are gone and are
replaced by a fabricated statement about tests that were never run. The `[eco-mcp: compressed …]`
note reads as a successful optimisation. An agent has no way to detect the loss, and `exit 0`
corroborates the lie. This is the most damaging defect in the repo, and on a flat-rate plan the
feature it belongs to has no upside to trade against it.

### 6.3 Stale index ⇒ wrong about exactly the code being worked on

`src/backends/structural.ts:26-32`:

```ts
  private project(workdir: string): string | null {
    if (this.projectByDir.has(workdir)) return this.projectByDir.get(workdir)!;
    const res = this.cli("index_repository", { repo_path: workdir });
    const project = res?.project ?? null;
    if (project) this.projectByDir.set(workdir, project);
    return project;
  }
```

`index_repository` runs once per workdir per process. The MCP server is long-lived — one process for
an entire Claude Code session. Demonstrated in a sandbox, single server process throughout:

```
1) before any edit, search originalSymbol:
    originalSymbol (Function) alpha.ts(a: number)

2) after writing brandNewSymbol + FreshlyAddedClass, same server:
   brandNewSymbol   -> no symbols match /brandNewSymbol/
   FreshlyAddedClass-> no symbols match /FreshlyAddedClass/

3) after DELETING originalSymbol from the file:
   originalSymbol   -> originalSymbol (Function) alpha.ts(a: number)
```

Code written during the session is invisible. Code deleted during the session is still reported as
present. Both failures are silent and phrased with full confidence.

**The backend is not at fault.** Forcing a re-index of the same directory resolves all three cases
correctly (`FreshlyAddedClass` found, `originalSymbol` correctly gone). And it is cheap — warm
re-index of hono, 284 TypeScript files: **11 ms**, twice in a row. Cold index of a 6-file directory:
113 ms. Warm `search_graph`: 5 ms.

So the fix is to drop the `projectByDir` cache and re-index per query, at a cost of ~11 ms. As it
stands, the tool is least reliable precisely where a coding agent needs it most — on the code it just
touched — while `Grep` reads the filesystem and is never wrong about it. **This alone answers the
framing question: no, this user should not call `search_structure` instead of `Grep`.**

### 6.4 Missing binaries — handled, with one caveat

`resolveBin` (`src/util/bin.ts:13-20`) returns `null` and each tool short-circuits with a message
(`src/server.ts:42-43`, `:63-64`, `:84-85`). No crash. Caveat: the failures return plain text, not an
MCP error — the SDK's `isError` flag is never set, so a missing backend is indistinguishable from a
successful empty result at the protocol level. Same for `"structural index unavailable"`
(`src/backends/structural.ts:37`) and `"semantic search failed"` (`src/backends/semantic.ts:25`).

### 6.5 The auto-locate chain, and why one link is dead in real deployments

`src/util/bin.ts:13-29`:

```ts
export function resolveBin(envVar: string, name: string, fallbacks: string[] = []): string | null {
  const env = process.env[envVar];
  if (env && existsSync(env)) return env;
  const onPath = which(name);
  if (onPath) return onPath;
  for (const f of fallbacks) if (existsSync(f)) return f;
  return null;
}

export function repoFallbacks(name: string): string[] {
  const home = process.env.HOME ?? "";
  return [
    join(process.cwd(), "bench", ".tools", name),
    join(home, ".local", "bin", name),
  ];
}
```

Order: `ECO_CBM_BIN`/`ECO_SEMBLE_BIN` → `PATH` via `command -v` → `$CWD/bench/.tools/<name>` →
`~/.local/bin/<name>`.

Two problems. **The `bench/.tools` fallback is `process.cwd()`-relative, not module-relative.** An MCP
server launched the way `README.md:54-64` documents inherits the *client's* working directory — the
user's project — so it resolves to `<user-project>/bench/.tools/…` and never matches. It only works
when the server is launched from the eco-mcp checkout. Should be `import.meta.dir`-relative.
**And `repoFallbacks("semble")` points at `bench/.tools/semble`, which does not exist** — `.tools`
contains only `codebase-memory-mcp`, `rtk`, `install.sh`, `LICENSE`. semble resolves via
`~/.local/bin` or not at all.

Also: `which()` at `src/util/bin.ts:6-10` shells out through `sh -c` on every server start, and
`ECO_*` overrides are checked with `existsSync` but never for executability.

### 6.6 No version pin anywhere

- `README.md:37` installs from `…/releases/latest/download/…` — whatever is newest that day.
- `bench/.tools/install.sh:25` defaults to `…/releases/latest/download`.
- `README.md:39` — `uv tool install semble`, unpinned.
- No minimum-version check, no capability probe, no startup handshake. Nothing would have caught §6.1.
- `git submodule status` *does* record SHAs (semble `v0.3.3`, rtk `dev-0.43.0-rc.271`, 9router
  `v0.4.71`, cocoindex `v0.2.35`, codebase-memory-mcp and gortex on `heads/main`) — but §7 shows the
  runtime never loads anything from `vendor/`, so those pins are decorative.

### 6.7 Blocking subprocesses

Every backend call is `Bun.spawnSync` with no `timeout` — `src/backends/structural.ts:18`,
`src/backends/semantic.ts:18`, `src/server.ts:105`, `src/util/bin.ts:7`. In a single-threaded stdio
server this blocks the event loop for *all* tools, not just the caller. Measured costs are low
(5–11 ms structural, 1,089 ms for `retrieve`), so this is latent rather than active — but
`run_command` will happily be handed a long-running or interactive command and freeze the whole
server with no timeout and no cancellation.

### 6.8 Index state leaks and accumulates

`codebase-memory-mcp` keeps one global persistent project store. Six projects are registered on this
machine, four of them dead temp directories created by test runs:

```
"available_projects":["<local-path>-bench-fixtures-sample-app",
"<temp-dir-1>","<temp-dir-2>","<temp-dir-3>","<temp-dir-4>",
"<local-path>-bench-fixtures-oss-hono"]
```

Nothing in eco-mcp cleans up. Every `bun run test:client` (`test/client.ts:39-44`) permanently
registers another throwaway workspace.

---

## 7. Dead weight

**`vendor/` — 1.3 GB, effectively unused.** Seven submodules. Sizes: `codebase-memory-mcp` **1.3 G**,
`gortex` 27 M, `9router` 11 M, `rtk` 4.8 M, `semble` 3.2 M, `cocoindex-code` 1.3 M, `caveman` 1.3 M.
No file in `src/` or `bench/src/` references `vendor/` at all — the two backends that actually run
resolve to `bench/.tools/` and `~/.local/bin` (§6.5). `gortex`, `cocoindex-code`, `9router` and
`caveman` appear **only** in `docs/`. `README.md:75` calls this "the upstream tools we build on";
in practice it is a 1.3 GB clone tax on `--recurse-submodules` for reference material. Keep the two
that are used, or drop all seven and keep `docs/infra/reference-repos.md` as the record.

**`bench/.tools/rtk` — 10 MB binary, never invoked.** Zero references in any `.ts` file. `docs/vision/demo-plan.md:84` still lists "Wire **rtk** as the real output-compression backend" as pending; §1.5 shows the compression is three hand-rolled regexes instead. Given §6.2's recommendation to delete `run_command`, this is now leftover from a direction that should not be resumed.

**`bench/.tools` is 252 MB** (a 253 MB `codebase-memory-mcp` binary) sitting inside the repo tree.

**`.specify/` + `.claude/skills/speckit-*` — spec-kit scaffolding, never used.** 14 skill
directories, plus `.specify/{templates,scripts,workflows,extensions,memory,integrations}`. There is
no `specs/` directory and no feature spec was ever created. `CLAUDE.md` — the file loaded into every
agent's context in this repo — is entirely this:

```
<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
```

It points every agent at a plan that does not exist, and contains nothing about eco-mcp. Replacing
this with a real CLAUDE.md is a five-minute, high-value fix independent of any repositioning.

**`before.md` (4.9 K) and `gemini.md` (37 K)** — working notes, not project files. There is also an
internal baseline document (untracked, not part of this repo) which is worth keeping but is out of
scope for this pass.

**`SPEC.md`** — the original v0 spec. Substantially unbuilt: §2.1 pre-flight token/burn-rate estimator
(not started), §2.2 AC-stripping and diff-only payloads (not started), §2.4 cheap-model CCI synthesis
(not started — §4), §3.3 "Gateway intercepts `find`/`grep`" (architecturally impossible for an MCP
server, which can only offer tools alongside native ones, never intercept them). Its §4 claims —
"90% reduction in input tokens," "70-80% drop in daily API billing" — are the thesis §1 dissolves.
Keep as history, do not keep as spec.

**`bench/results/*.json|md`** — five artifacts from 2026-06-09, superseded by the docs.

**Half-built, worth noting as scope rather than junk:** `README.md:79-81` accurately lists
cache-aware egress, burn-rate meter, and model routing as not built. All three are cost features. All
three should now be cut rather than scheduled.

---

## What this means for the repositioning

The token thesis is not merely irrelevant to the new target user — §1.4 shows it was not true against
a competent grep for *any* user. That is worth separating cleanly, because it changes what has to be
retracted publicly versus merely de-emphasised.

What survives contact with a flat-rate Opus 5 user in Claude Code:

- **`get_context`/`update_context` is the entire remaining product.** It is the one capability with no
  native equivalent, and the one whose value never depended on token cost — per-module institutional
  knowledge that is not recoverable from the source at any price. It is also the least-built thing
  here: no staleness binding (§3.2), no content constraint (§3.3), no merge (§3.1), no containment
  (§3.5). The gap between the idea and the implementation is the whole opportunity.
- **`retrieve` is a genuine secondary.** It answers questions with no greppable keyword, which Grep
  structurally cannot. Sell it on that, not on tokens.
- **Everything else is either redundant, broken, or both.**

The three things worth doing before any repositioning writeup, in order:

1. **Fix or delete the two tools that lie** — `find_concept` (§6.1) and `run_command` (§6.2). Shipping
   a tool that answers `cat package.json` with "all checks passed" outweighs every benchmark number in
   the repo.
2. **Drop the `projectByDir` cache** (§6.3). Eleven milliseconds turns `search_structure` from
   actively misleading into merely redundant — and that is the difference between a tool that damages
   trust and one that is simply unnecessary.
3. **Correct the benchmark claims** (§1.4). The definition-scoped counter-numbers — 132 vs 260, 2,723
   vs 7,932 — are more credible material than the originals were. `benchmark-results.md:94-95` already
   frames "we found and corrected our own overclaim" as the credibility play; that play is still
   available, and it is stronger the second time.

One closing note on the strategy itself. Given that the surviving value here is Context Packs —
reading and writing markdown files in the repo — it is worth asking whether that needs an MCP server,
three vendored binaries and a 1.5 GB checkout at all, or whether it is a skill plus a convention.
That question is outside this pass's scope, but the evidence in §2 and §7 points at it hard enough to
be worth stating.

---

### Reproducing the measurements in this report

```bash
cd bench && bun run src/microbench.ts        # §1.1 — reproduces the published table exactly
bun run test:client                          # §2, §6 — spawns the server, exercises 6 of 7 tools
bench/.tools/codebase-memory-mcp cli search_graph \
  '{"project":"<indexed-project>","semantic_query":["anything at all"]}'   # §6.1 — returns all 3529 symbols
```

The §1.4 counter-benchmark, the §3.5 containment probe, the §6.2 compressor probe and the §6.3
staleness probe were run from throwaway scripts in the session scratchpad; none wrote to this repo.
The §6.3 result is the one to re-run first if only one is re-run.
