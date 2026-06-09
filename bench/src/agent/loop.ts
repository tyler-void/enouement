// Minimal ReAct-style agent loop. Provider-agnostic via LLMClient.

import type { ChatMessage, LLMResponse, Profile, Task, Usage } from "../types";
import { ZERO_USAGE, addUsage } from "../types";
import type { LLMClient } from "./llm";
import { buildToolKit, type ToolContext } from "./tools";
import type { Backends } from "./backends";

const TERSE_PREAMBLE =
  " Respond in the fewest tokens possible: no preamble, no pleasantries, no restating the question. Fragments over sentences. Act via tools; only emit prose in the final `finish` answer.";

function systemPrompt(profile: Profile): string {
  const base =
    "You are a coding agent working in a small TypeScript repository. " +
    "Investigate and complete the task using the provided tools. " +
    "Prefer targeted searches over reading whole files. " +
    "When the task is done, call `finish` with a one-line answer. " +
    "For bug-fix/feature tasks, make the relevant test pass before finishing.";
  return profile.terse ? base + TERSE_PREAMBLE : base;
}

export interface AgentOutcome {
  finalAnswer: string;
  usage: Usage;
  turns: number;
  stopped: "finished" | "no_tool" | "max_turns";
}

export async function runAgent(
  task: Task,
  profile: Profile,
  client: LLMClient,
  workdir: string,
  backends: Backends,
  maxTurns = 14,
): Promise<AgentOutcome> {
  const kit = buildToolKit(profile, backends);
  const ctx: ToolContext = { workdir };
  const system = systemPrompt(profile);

  const messages: ChatMessage[] = [
    {
      role: "user",
      content:
        `TASK (${task.type}): ${task.prompt}\n\n` +
        `Start by listing or searching the repo. Tools available: ${kit.defs
          .map((d) => d.name)
          .join(", ")}.`,
    },
  ];

  let usage: Usage = { ...ZERO_USAGE };
  let finalAnswer = "";
  const pace = Number(process.env.BENCH_PACE_MS ?? 0); // inter-request delay for free-tier RPM

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (pace > 0) await Bun.sleep(pace);
    // After the SDK's own 8 retries, a failure is real — let it propagate so run.ts records it
    // as an error (visible) rather than silently scoring the task as a failure.
    const resp: LLMResponse = await client.send(system, messages, kit.defs, {
      caching: profile.caching,
    });
    usage = addUsage(usage, resp.usage);

    if (resp.toolCalls.length === 0) {
      // model answered in prose without calling finish — treat as final
      finalAnswer = resp.text;
      return { finalAnswer, usage, turns: turn, stopped: "no_tool" };
    }

    // record the assistant turn (text + tool calls)
    messages.push({ role: "assistant", content: resp.text, toolCalls: resp.toolCalls });

    for (const call of resp.toolCalls) {
      const result = kit.run(call, ctx);
      messages.push({ role: "tool", toolCallId: call.id, content: result });
      if (kit.isFinish(call.name)) {
        finalAnswer = String(call.args.answer ?? result);
        return { finalAnswer, usage, turns: turn, stopped: "finished" };
      }
    }
  }

  return { finalAnswer: finalAnswer || "(max turns reached)", usage, turns: maxTurns, stopped: "max_turns" };
}
