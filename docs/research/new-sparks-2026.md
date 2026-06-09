# Research — New Sparks (deep dive, June 2026)

_Last updated: 2026-06-09. Synthesis of 5 parallel research sweeps. Every claim has a source;
vendor-marketing numbers are flagged._

This goes beyond the original 4 pillars. The headline finding: **our SPEC.md missed the
single biggest lever — prompt caching — and underweighted routing and small-model
scaffolding.** Below, ordered by impact on the actual problem ($60 in 9 days, 5–100+ credits
per prompt cycle).

---

## ⭐ SPARK 0 — Prompt caching is the #1 immediate win (we had zero coverage of it)

Agentic coding re-sends a large, mostly-stable prefix (system + tools + repo context +
growing transcript) **every turn**. Without caching you pay full input price on all of it,
every turn. With caching, the repeated prefix drops to **~10% of input price**.

**Provider mechanics (× base input price):**

| Provider | Mode | Cache write | Cache read | Min prefix | Note |
|----------|------|------------|-----------|-----------|------|
| Anthropic | explicit breakpoints (`cache_control`) | 1.25× (5min) / 2× (1hr) | **0.1×** | **4096 (Opus 4.8 / Haiku 4.5)**, 2048 (Sonnet 4.6) | strict prefix match; 4 breakpoints; 20-block lookback |
| OpenAI | automatic | none | ~0.1–0.5× | 1024 | zero-config, longest prefix |
| Gemini | implicit (auto) + explicit | none / storage | 0.1× (2.5+) | ~1024 / 32768 explicit | explicit can cost more once storage counted |
| DeepSeek | automatic disk | none | ~0.1× | prefix-from-0 | cleanest economics, no write fee |

**Copilot interaction (load-bearing):** GitHub's new AI-Credit billing **passes through
provider cache pricing** — cached tokens bill at ~10% of standard input across models
(Anthropic models also pass through the write surcharge). So caching directly reduces your
credit meter. **But the bigger Copilot lever is the model multiplier** — annual-plan
multipliers jumped sharply June 1 (reported Opus 7.5×→27×). Your $60 burn is likely driven
as much by routing every turn to a high-multiplier model as by uncached input.

**Rules to maximize cache hits — "stable-first, volatile-last":**
1. Freeze the prefix order: system → tools → context packs → conversation.
2. **Never** put timestamps / session-UUIDs / "current date" near position 0 — #1 silent
   cache-buster.
3. Deterministic tool list: sort tools by name, serialize JSON with sorted keys. Adding/
   reordering one tool busts the entire cache (tools render first).
4. Append-only conversation; breakpoint on the last block of the newest turn.
5. Don't switch models mid-session (caches are model-scoped).
6. Respect minimums (3K prefix won't cache on Opus 4.8 — needs 4096).

**Realistic savings (skeptical):** Anthropic's "up to 90%" = discount on the *cached slice
only*, not the bill. A real measured workload (ProjectDiscovery) cut **total LLM cost 59%**.
For agentic coding, prefix is 80–95% of input and re-sent every turn → realistic **blended
50–70% total spend reduction** combining cache passthrough + multiplier-aware routing. Output
tokens never cache, so total savings cap below the input-only figure.

**Design:** make the gateway *cache-aware* — canonicalize request prefixes deterministically,
auto-inject `cache_control` breakpoints for clients that don't, strip cache-busters, pin model
per session. **Standardize on [LiteLLM](https://docs.litellm.ai/docs/proxy/caching)** as the
proxy core (supports Redis/disk + semantic caching + forwards `cache_control`).

> ⚠️ **THE central design tension (see SPARK 2):** prompt caching and context-pruning fight
> each other. Mid-history edits bust the cache. This constraint gates every other technique.

Sources: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) ·
[OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) ·
[DeepSeek KV cache](https://api-docs.deepseek.com/guides/kv_cache) ·
[Copilot models & pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) ·
[ProjectDiscovery 59% cut](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching) ·
[LiteLLM caching](https://docs.litellm.ai/docs/proxy/caching)

---

## ⭐ SPARK 1 — Make cheap models punch above their weight (the routing + scaffolding ladder)

Baseline (SWE-bench Verified, mid-2026): raw 7–13B <5%; 30–70B teens–high-20s with a strong
harness; best tuned sub-100B (SWE-RL-70B) 41%; frontier 80–93%. **The gap is mostly closeable
by scaffolding, not raw IQ — for scoped tasks.** No scaffold makes a 13B do an 80%-grade
architectural change.

**Build order (impact × ease in a gateway):**

1. **Context-trimming + repo few-shot** — cheapest, immediate. Small models are
   *disproportionately* hurt by noisy context; clean context + 1–2 repo exemplars helps them
   far more than it helps frontier models. Code generation tolerates aggressive compression
   (ratio ≥0.6) where chain-of-thought does not.
2. **Execution-grounded repair loop (3-attempt cap)** — biggest single accuracy lift.
   *Intrinsic* self-critique ("are you sure?") is unreliable and often negative for small
   models (Self-Refine −5.6% on 1B). What works: **real execution feedback** — run
   tests/linter/build, feed back only the raw error + failing lines, re-prompt. Agents
   self-correct **70.3%** of errors given interpreter output. Cap at 3 then escalate.
3. **Escalation ladder with objective stuck-detection** — the cost-control backbone.
   Cascading routing hits **~95% of GPT-4 quality at ~14% frontier calls (~75% cost cut)**.
   "Stuck" = concrete signals: tests still failing after N tries, invalid/non-applying diff,
   **near-identical re-emission** (small models revise <0.05 edit-distance in 93% of stuck
   cases), budget exceeded. Escalate the *task*, not every turn.
4. **Plan-then-execute, gated on complexity** — one strong planning call → cheap models
   execute atomic steps. Pre-Act shows +70% action recall over ReAct. One frontier plan
   amortizes across many cheap executions. Gate it — pure tax on trivial single-file edits.
5. **Constrained/structured decoding** — only if self-hosting (vLLM/SGLang/llama.cpp).
   XGrammar-2: grammar-constrained Llama-3.2-3B *beats* unconstrained Llama-3.1-70B on
   tool-calling. **Constrain the final edit/tool envelope, NOT the reasoning** (over-
   constraining reasoning causes "structure snowballing"). For hosted APIs, force vendor
   JSON/tool mode.
6. **Fast-apply / speculative edit model** — *conditional*. Morph claims 98–100% merge vs
   84–96% search-replace, 700–1400 tok/edit vs 3500–4500 full-rewrite. BUT contested: Cognition
   dropped fast-apply; a quantized 7B can silently corrupt on vague instructions. Default to
   **search-replace/unified-diff validated by re-parse + re-run tests**; add fast-apply only if
   the cheap planner produces reliably precise edit instructions.
7. **LoRA / distillation on the repo** — defer. Scaffolding (1–5) gets most of the way at
   near-zero setup. LoRA is for *behavioral/style* adaptation, not injecting repo facts
   (that's retrieval's job). Harvest escalation traces now → enable distillation later as phase 2.

**Routers to study/build on:** [RouteLLM](https://github.com/lm-sys/RouteLLM) (difficulty
classifier), [Not Diamond / RoRF](https://github.com/Not-Diamond/RoRF),
[LiteLLM routing](https://docs.litellm.ai/docs/routing). ⚠️ LiteLLM has a known
retry→fallback loop bug ([#19985](https://github.com/BerriAI/litellm/issues/19985)) and a
[2026 supply-chain incident](https://www.trendmicro.com/en_gb/research/26/c/inside-litellm-supply-chain-compromise.html)
— pin a known-good version, verify integrity.

Sources: [SWE-bench scores](https://www.codeant.ai/blogs/swe-bench-scores) ·
[self-correcting SLMs](https://arxiv.org/html/2505.23060v3) ·
[XGrammar-2](https://arxiv.org/pdf/2601.04426) ·
[RouteLLM](https://github.com/lm-sys/RouteLLM) ·
[Morph fast-apply](https://www.morphllm.com/fast-apply-model) ·
[fast-apply skeptic](https://pashpashpash.substack.com/p/fast-apply-models-are-already-dead)

---

## ⭐ SPARK 2 — Context engineering: keep the working set small (but mind the cache)

On Anthropic's model, **token usage alone explains ~80% of performance variance** — so
trimming isn't free; past a point you trade correctness for cost.

**Patterns ranked by impact on the recurring per-turn context the gateway re-bills:**

| Pattern | Impact | Cache interaction | Gateway can enforce? |
|---------|--------|-------------------|---------------------|
| **Sub-agent isolation** | Very high (~25×: 40K exploration → 1.5K summary to parent) | neutral; +overhead, total tokens 4–15× | partly (offer `delegate` tool; route big outputs into isolated sub-call) |
| **File/memory offloading** | High (~70–85% active-context cut) | **HELPS** (small stable refs) | **yes** — intercept large tool outputs, spool to local store, replace with stub `[ref=abc, 1240 lines]` + `fetch(ref,range)` tool |
| **JIT retrieval + lazy tool schemas** | High structural | mildly helps; don't toggle schemas mid-session | **yes** — lazy MCP schema loading |
| **Compaction / summarization** | High but **spiky** | **HURTS** (full messages-cache miss) | yes — `compact_20260112`, trigger 150K default / 50K min; cache-mark the summary block |
| **Pruning / dedup file reads** | Medium, continuous | **HURTS if mid-prefix**; safe only at tail or during compaction | yes, carefully |
| **Cross-session memory (MCP)** | Cross-session, not per-turn | helps (small digest) | yes — local MCP memory server |

**The overarching gateway rule:** prompt is **append-only** with cache breakpoints at
`[tools][system][stable-history]`; all aggressive mutation (compaction + batched pruning)
happens at **discrete threshold events, not per turn**; large/duplicate payloads are offloaded
to local storage and stubbed the moment they arrive. **Biggest risk: a "savings" edit that
busts a large cached prefix and costs 10× the turn it optimized.** The gateway must estimate
expected cache-bust cost before any mid-history edit.

Note: subagents are cheaper for the *parent's* recurring context but **more expensive in total
tokens** (Anthropic multi-agent used ~15× a chat). Use only above a token-volume threshold.

Sources: [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) ·
[Anthropic multi-agent](https://www.anthropic.com/engineering/multi-agent-research-system) ·
[Compaction docs](https://platform.claude.com/docs/en/build-with-claude/compaction) ·
[mem0 playbook](https://mem0.ai/blog/the-2026-token-optimization-playbook-cut-ai-agent-memory-costs-3%E2%80%934x)

---

## ⭐ SPARK 3 — Newest tools & papers worth mining (Apr–Jun 2026)

Beyond our 7 vendored repos. Top picks to actually borrow from:

- **sem** ([ataraxy-labs/sem](https://github.com/ataraxy-labs/sem), Rust, MIT/Apache, ~2.5k★)
  — **strongest new code-intel find.** Entity-level semantic VCS for agents: `sem diff` reports
  *which functions/classes changed* (with rename detection), plus `blame`/`impact`/`log` at
  entity granularity, JSON + MCP (6 tools). Feeding "function `foo` changed, callers X/Y
  affected" instead of a raw line diff is a big output-token cut *and* better signal. The
  impact-analysis is something gortex/codebase-memory don't surface as cleanly.
- **Headroom** ([chopratejas/headroom](https://github.com/chopratejas/headroom)) — open-source
  "Context Optimization Layer" proxy, 60–95% compression. **Reversible compression (CCR):**
  compressed chunks stay local, model fetches originals via a `headroom_retrieve` tool;
  content-type router picks a compressor (JSON / AST-aware code / prose). The
  `headroom wrap claude|cursor|copilot` CLI UX is worth stealing. (Star count partly SEO-inflated.)
- **Context Gateway** ([Compresr-ai](https://github.com/Compresr-ai/Context-Gateway),
  [Show HN](https://news.ycombinator.com/item?id=47367526)) — **intent-conditioned compression**:
  compresses tool output based on *why* the tool was called (a signal our gateway already has
  — it sees the tool name); `expand()` recovers originals. HN flagged the real risk:
  **prompt-injection via compressed untrusted content** — applies to us too.
- **AgentDiet** ([arXiv:2509.23586](https://arxiv.org/abs/2509.23586), FSE 2026) —
  inference-time **trajectory reduction** (remove useless/redundant/**expired** turns):
  −39.9–59.7% input tokens, no accuracy loss. Directly implementable in a stateful gateway.
- **Squeez** ([arXiv:2604.04979](https://arxiv.org/pdf/2604.04979)) & **SWE-Pruner**
  ([arXiv:2601.16746](https://www.arxiv.org/pdf/2601.16746), 64% SWE-bench at −31% tokens) —
  academic mirrors of task-conditioned tool-output pruning; structured pruning > naive
  compression.
- **TOON** ([toon-format/toon](https://github.com/toon-format/toon)) — Token-Oriented Object
  Notation: 30–60% fewer tokens than JSON for **uniform arrays of objects** (search results,
  file lists, graph nodes). Low-effort win for structured tool output the gateway emits.
  Gains real only for homogeneous tabular data.
- **Cross-Lingual Token Arbitrage** ([arXiv:2606.03618](https://arxiv.org/html/2606.03618v1))
  — **relevant to us: a Vietnamese user base.** Non-English costs 2–3× tokens; a local 3B
  model pre-translates prompts to English + reformats: −34–47% prompt tokens, accuracy flat/up.
  Dollar savings were mixed — gate behind a token-budget guard.

**Consensus notes:** **Code Mode** (expose MCP tools as code APIs, model writes code that calls
them) is now *table-stakes*, not a differentiator — Anthropic (98.7%) and Cloudflare (99.9% on
2500 endpoints) both ship it. The Copilot-pricing reaction is mostly listicles + routers
(CodeRouter phase-aware routing, NadirClaw 10ms embedding-centroid classifier) — no novel tech,
but **routing-on-work-phase** (plan/implement/debug/edit, read from tool-call history) is a
non-obvious axis a gateway is uniquely positioned to use.

Sources inline above.

---

## What this changes about our plan

1. **Add a 5th pillar: Caching & Request Canonicalization** — likely the biggest single win,
   and it was entirely absent from SPEC.md. See [../infra/architecture.md](../infra/architecture.md).
2. **Don't reinvent routing** — build on 9router; add phase/complexity-aware model selection.
3. **The retrieval pillar gets a decisive stack** — see
   [../infra/recommended-stack.md](../infra/recommended-stack.md).
4. **Small-model success is a scaffolding ladder**, not a single trick — execution-repair loop
   + escalation is the core that lets Haiku/GPT-mini finish tasks.
5. **The cache-vs-pruning tension is the hardest engineering constraint** — design append-only,
   mutate at thresholds, offload+stub instead of inline.
