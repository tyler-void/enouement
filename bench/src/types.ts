// Shared types for the benchmark harness.

/** Normalized token usage from any provider. */
export interface Usage {
  input: number; // uncached input tokens (full price)
  cachedRead: number; // input tokens served from cache (~0.1x)
  cacheWrite: number; // tokens written to cache this call (Anthropic; ~1.25x)
  output: number; // output/completion tokens
}

export const ZERO_USAGE: Usage = { input: 0, cachedRead: 0, cacheWrite: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cachedRead: a.cachedRead + b.cachedRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/** A tool the agent can call. */
export interface ToolDef {
  name: string;
  description: string;
  // JSON-schema-ish parameter spec (provider-agnostic; clients translate).
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** One LLM round-trip result, normalized across providers. */
export interface LLMResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: string;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  // for assistant turns that requested tools:
  toolCalls?: ToolCall[];
  // for tool-result turns:
  toolCallId?: string;
}

/** Profile = one rung of the ablation ladder. Toggles which levers are active. */
export interface Profile {
  id: string; // "A0".."A5"
  label: string;
  provider: "anthropic" | "openai-compat" | "gemini";
  model: string; // must exist in pricing.ts
  caching: boolean; // inject cache_control / rely on auto caching
  retrieval: boolean; // replace raw grep/read with compact retrieval tool
  compressOutput: boolean; // run command/tool output through rtk-style compression
  terse: boolean; // inject caveman-style terse-output system preamble
  escalation: boolean; // (reserved) escalate to a stronger model on repeated failure
  note?: string;
}

/** A benchmark task on the sample app. */
export interface Task {
  id: string;
  type: "navigate" | "fix" | "feature";
  prompt: string; // the user instruction handed to the agent
  // Prepare a fresh working copy (prune unrelated tests, plant state, etc.).
  setup: (workdir: string) => Promise<void> | void;
  // Decide success. `finalAnswer` is the agent's last assistant text.
  check: (workdir: string, finalAnswer: string) => Promise<TaskCheck> | TaskCheck;
}

export interface TaskCheck {
  pass: boolean;
  detail: string;
}

/** A named benchmark suite = a fixture repo + its tasks. */
export interface Suite {
  id: string;
  fixtureDir: string;
  /** false for read-only suites: run in place (no per-run copy), so indexes are reused. */
  copyPerRun: boolean;
  tasks: Task[];
}

/** Result of one (task, profile, run-index) execution. */
export interface RunResult {
  taskId: string;
  profileId: string;
  run: number;
  pass: boolean;
  checkDetail: string;
  usage: Usage;
  costUSD: number;
  turns: number;
  wallMs: number;
  error?: string;
}
