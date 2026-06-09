// Provider-agnostic LLM clients with normalized usage capture.
//
// Two implementations:
//  - AnthropicClient: native Messages API; injects `cache_control` breakpoints when caching
//    is on, and reads cache_creation/cache_read usage fields (accurate caching measurement).
//  - OpenAICompatClient: any OpenAI-compatible endpoint (OpenAI, 9router, LiteLLM, …).
//    Caching is automatic upstream; we just read prompt_tokens_details.cached_tokens.
//
// Env:
//  ANTHROPIC_API_KEY                          -> AnthropicClient
//  LLM_BASE_URL + LLM_API_KEY (+ optional)    -> OpenAICompatClient (point at 9router/LiteLLM)
//  OPENAI_API_KEY                             -> OpenAICompatClient against api.openai.com

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatMessage, LLMResponse, ToolCall, ToolDef, Usage } from "../types";

export interface LLMClient {
  send(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: { caching: boolean; maxTokens?: number },
  ): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  constructor(
    private model: string,
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    // maxRetries: SDK does exponential backoff on 429/5xx and honors Retry-After — essential
    // so rate-limit blips don't drop a call and corrupt a run's token count.
    this.client = new Anthropic({ apiKey, maxRetries: 8, timeout: 120_000 });
  }

  async send(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: { caching: boolean; maxTokens?: number },
  ): Promise<LLMResponse> {
    const cc = opts.caching ? { cache_control: { type: "ephemeral" as const } } : {};

    const systemBlocks = [{ type: "text" as const, text: system, ...cc }];

    const apiTools = tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: "object" as const, ...(t.parameters as object) },
      // breakpoint on the last tool caches the whole tools+system prefix
      ...(opts.caching && i === tools.length - 1 ? cc : {}),
    }));

    const apiMessages = toAnthropicMessages(messages);

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      system: systemBlocks as any,
      tools: apiTools as any,
      messages: apiMessages as any,
    });

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as any });
    }

    const u = resp.usage;
    const usage: Usage = {
      input: u.input_tokens ?? 0,
      cachedRead: (u as any).cache_read_input_tokens ?? 0,
      cacheWrite: (u as any).cache_creation_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    };

    return { text, toolCalls, usage, stopReason: resp.stop_reason ?? "end" };
  }
}

function toAnthropicMessages(messages: ChatMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? [])
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      out.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible
// ---------------------------------------------------------------------------

export class OpenAICompatClient implements LLMClient {
  private client: OpenAI;
  constructor(
    private model: string,
    override?: { baseURL?: string; apiKey?: string },
  ) {
    const baseURL = override?.baseURL ?? process.env.LLM_BASE_URL; // e.g. http://localhost:20128/v1 (9router)
    const apiKey = override?.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("LLM_API_KEY (or OPENAI_API_KEY) not set");
    this.client = new OpenAI({ apiKey, maxRetries: 8, timeout: 120_000, ...(baseURL ? { baseURL } : {}) });
  }

  async send(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: { caching: boolean; maxTokens?: number },
  ): Promise<LLMResponse> {
    // Caching is automatic on OpenAI-compatible providers; nothing to inject.
    const apiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: { type: "object", ...(t.parameters as object) },
      },
    }));

    const apiMessages = toOpenAIMessages(system, messages);

    const resp = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      tools: apiTools,
      tool_choice: "auto",
      messages: apiMessages as any,
    });

    const choice = resp.choices[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeJson(tc.function.arguments),
    }));

    const u = resp.usage;
    const cachedRead = (u as any)?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage: Usage = {
      // clamp: a malformed/proxy usage payload where cached > prompt_tokens must not yield a
      // negative input (which would silently discount cost). max(0, ...) guards that.
      input: Math.max(0, (u?.prompt_tokens ?? 0) - cachedRead),
      cachedRead,
      cacheWrite: 0,
      output: u?.completion_tokens ?? 0,
    };

    return {
      text: msg?.content ?? "",
      toolCalls,
      usage,
      stopReason: choice?.finish_reason ?? "stop",
    };
  }
}

function toOpenAIMessages(system: string, messages: ChatMessage[]): any[] {
  const out: any[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : {}),
      });
    else if (m.role === "tool")
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Build the client a profile asks for. */
export function makeClient(provider: string, model: string): LLMClient {
  if (provider === "anthropic") return new AnthropicClient(model);
  if (provider === "gemini")
    return new OpenAICompatClient(model, {
      baseURL: GEMINI_BASE_URL,
      apiKey: process.env.GEMINI_API_KEY,
    });
  return new OpenAICompatClient(model);
}
