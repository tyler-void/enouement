# Research — Academic Foundation

_Last updated: 2026-06-09._

Three papers form the empirical backbone of the project. **All three are real and verified**
(the original SPEC cited only the first, paraphrasing its title — corrected below).

---

## 1. arXiv:2604.22750 — the foundational citation

**"How Do AI Agents Spend Your Money? Analyzing and Predicting Token Consumption in
Agentic Coding Tasks"**
Longju Bai, Zhemin Huang, Xingyao Wang, Jiao Sun, Rada Mihalcea, Erik Brynjolfsson,
Alex Pentland, Jiaxin Pei — April 2026.

> ⚠️ `SPEC.md` paraphrases the title as *"Profiling Token Flows in Agentic Coding."* The
> arXiv ID and findings are genuine; consider citing the real title in the pitch deck.

First systematic study of token consumption in agentic coding, analyzing trajectories from
**8 frontier LLMs on SWE-bench Verified**, plus models' ability to predict their own cost.

**Three findings to put on the pitch slide:**
1. **Agentic coding is uniquely expensive** — ~**1000×** more tokens than code chat/reasoning,
   and **input tokens (not output)** drive the cost.
2. **Spending more ≠ better code** — accuracy is **not** linear with tokens; it plateaus
   (and can degrade as context gets noisy).
3. **Agents can't count** — models predict their own token usage poorly (weak-to-moderate
   correlation) and **systematically underestimate**. Same task, different run → up to **30×**
   variance.

Link: <https://arxiv.org/abs/2604.22750>

---

## 2. arXiv:2601.14470 — where the tokens actually go

**"Tokenomics: Quantifying Where Tokens Are Used in Agentic Software Engineering"**
(Jan 2026). Empirical analysis of execution traces from 30 dev tasks in the ChatDev
multi-agent framework.

**Findings:**
- **Code Review / iterative refinement stage = 59.4%** of all token consumption. The cost is
  in *refinement and verification*, not initial generation.
- Token mix per task: **53.9% input / 24.4% output / 21.6% reasoning** — input dominates,
  corroborating Bai et al.

**Implication for us:** compression and retrieval must target the review/refinement loop, not
just first-pass generation. This is where burn-rate gating pays off most.

Link: <https://arxiv.org/abs/2601.14470>

---

## 3. Anthropic — "Code Execution with MCP" (engineering blog, Nov 2025)

Not a paper, but the most important *pattern* result for the gateway's MCP layer.

**Core idea:** instead of preloading every tool schema into context (a single large MCP
server can cost 10k–17k+ tokens before the model does anything), represent MCP servers as
**code-level APIs** and let the model write code in a sandbox that imports only the modules
it needs (progressive disclosure). Intermediate results stay in the execution environment.

**Result:** a workflow went from **~150,000 tokens → ~2,000 tokens (98.7% reduction)**;
validated in production scaled to 112 GitHub tools while holding the ~98% reduction.

**Implication for us:** directly informs Pillar 2's "MCP Schema Injector / dynamic tool
loading." Don't inject 20 schemas; expose tools as code APIs + load on demand.

Links:
- <https://www.anthropic.com/engineering/code-execution-with-mcp>
- <https://github.com/orgs/modelcontextprotocol/discussions/629> (production validation)
