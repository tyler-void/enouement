## TECHNICAL SPECIFICATION: ECO-MCP GATEWAY

**Project:** Enterprise-Grade AI Agent Cost-Optimization & Context Management Plugin
**Architecture Tier:** IDE Plugin / Local MCP Server
**Foundational Research:** arXiv:2604.22750 (Bai et al., 2026) - *Profiling Token Flows in Agentic Coding*

---

### 1. EXECUTIVE SUMMARY

The current operational model of AI-assisted development (Agentic Coding via Cursor/Cline) is fundamentally flawed regarding cost-efficiency and context retention. As proven by recent 2026 research, 99% of token consumption stems from *Input Tokens*—specifically, agents blindly executing raw `grep`, `cat`, and `find` commands, saturating the context window with boilerplate code, irrelevant imports, and noisy execution logs. Furthermore, implicit business logic remains trapped in developers' heads, making onboarding highly inefficient.

The **Eco-MCP Gateway** is an IDE Plugin (VS Code/Cursor compatible) that acts as an intercepting proxy and advanced Model Context Protocol (MCP) server. It aggressively trims I/O token consumption by 60-90% through structural/semantic code indexing, enforce strict budget tracking (burn rate limits), and introduces "Continuous Context Integration" (CCI) to transform project repositories into living, AI-readable knowledge bases.

---

### 2. CORE ARCHITECTURAL PILLARS

#### 2.1. Pre-Flight Token & Burn Rate Estimator (The Gatekeeper)

*Derived from `9router` logic.*
The plugin will not blindly forward API requests. It acts as a localized financial firewall.

* **Tokenizer Engine:** Integrates local token counting (`tiktoken` for OpenAI, Anthropic equivalent) to evaluate the payload *before* dispatch.
* **Budget Matrix Mapping:** Maps token counts against a dynamic pricing matrix (e.g., $0.00025/1k input for Haiku vs. $0.003/1k for Sonnet).
* **Hard Limits & Smart Fallback:** If a single request exceeds the predefined organizational threshold (e.g., `$0.05/request`), the Gateway intercepts and either:
1. Automatically falls back to a lower-tier, cost-effective model (e.g., GPT-4o-mini, Claude 3 Haiku).
2. Prompts the user to authorize the expense for complex, deep-reasoning tasks.



#### 2.2. The I/O Compression Pipeline (The Token Killer)

*Derived from `rtk` (Rust Token Killer) and `caveman` heuristics.*
LLMs hallucinate and degrade in reasoning quality when fed noisy data. The Gateway sanitizes all I/O operations:

* **CLI Output Truncation:** Intercepts terminal outputs (test runs, build logs). Strips `[INFO]`, progress bars, and standard success logs. Only injects pure stack traces and `[ERROR]` blocks into the context window.
* **Acceptance Criteria (AC) Stripping:** Integrates "Caveman Logic." When fetching User Stories or Jira tickets, the plugin strips corporate filler, pleasantries, and background narrative, reducing the AC to raw, functional bullet points (e.g., *"If X, do Y. Return 404"*).
* **Diff-Only Payloads:** Never send full files if only modifying a function. The plugin forces unified diff payloads for context updates.

#### 2.3. Advanced Retrieval: Structural & Semantic Indexing

Replaces expensive and highly inaccurate regex/text-based search with deterministic, optimized graph queries.

* **Semantic Search (`semble` integration):** Utilizes local, CPU-bound Model2Vec + BM25 indexing. When an agent queries conceptually (*"How is payment authorization handled?"*), the plugin bypasses the LLM's raw file-reading tool and returns exactly the top 5 highly relevant code chunks.
* **Structural Search (`codebase-memory-mcp` integration):** Parses the repository into an Abstract Syntax Tree (AST) backed by a local SQLite Graph. Enables the agent to execute graph-traversal tool calls (e.g., `get_call_hierarchy("processPayment")` or `find_implementations("AuthInterface")`) rather than blindly reading through directories. This reduces navigational token overhead from ~400k down to ~3k tokens per task.

#### 2.4. Continuous Context Integration (CCI) & Living Docs

*The solution to the "Newbie Onboarding" and "Knowledge Silo" problem.*

* **The `.context/` Directory:** A standardized, hidden directory structure matching the source tree (e.g., `src/modules/payment/.context/domain_logic.md`).
* **Trigger Mechanism:** Upon completion of a User Story or Defect resolution, the developer executes a plugin command (or triggers via Git hook).
* **Auto-Generation:** The plugin routes the `git diff` and the ticket details to a fast, cheap model (Haiku). The model synthesizes the business logic, architectural decisions, and edge cases, appending this summary to the respective `.context/*.md` file.
* **Enforced Code Review:** The `.context` update is automatically staged in the Pull Request. Reviewers must validate both the code implementation and the AI-generated context.
* **Context Pack Injection:** In future sprints, when an agent is assigned a task in that module, it does *not* read the codebase first. It reads the highly compressed `domain_logic.md` (Context Pack), gaining instant, accurate domain knowledge at a fraction of the token cost.

---

### 3. PLUGIN DATA FLOW (EXECUTION LIFECYCLE)

1. **Initialization:** The IDE Plugin mounts. `semble` and AST parsers run a lightweight background indexing on the local workspace (file-watcher enabled for real-time AST updates).
2. **Task Ingestion:** User assigns a task. The Gateway fetches the relevant Context Pack (`.context/*.md`) and injects it as the system prompt.
3. **Agentic Loop (Intercepted):**
* Agent attempts to understand the codebase -> Gateway intercepts `find`/`grep` -> Routes to local AST Graph/Semantics.
* Agent runs tests -> Gateway intercepts output -> Trims noise (`rtk` logic) -> Returns clean stack trace.


4. **Cost Check:** Every payload transition is calculated. If the agent enters an infinite loop or requests massive file reads, the Gateway halts execution, displaying the projected burn rate to the developer.
5. **Completion & CCI:** Code is finalized. Plugin auto-generates the domain knowledge diff and stages it for commit.

---

### 4. SUCCESS METRICS & ROI (For Evaluation)

* **Token Efficiency:** 90% reduction in input tokens via AST-graph retrieval and terminal log compression.
* **Cost Reduction:** Direct translation to a 70-80% drop in daily API billing for AI Agent workflows.
* **Onboarding Velocity:** New developers and their local AI agents require near-zero time to map project architecture, relying entirely on the auto-maintained Continuous Context Integration packs.
* **Maintainability:** 100% automated documentation lifecycle synchronized perfectly with the actual code state via mandatory PR reviews.