// The ablation ladder. Each profile turns on one more lever than the previous, so the
// report can attribute savings to each lever (a waterfall), not just to "the gateway".

import type { Profile } from "./types";

export type Provider = "anthropic" | "openai-compat" | "gemini";

export function detectProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER as Provider | undefined;
  if (explicit === "anthropic" || explicit === "openai-compat" || explicit === "gemini")
    return explicit;
  if (process.env.LLM_BASE_URL || process.env.LLM_API_KEY) return "openai-compat";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "openai-compat";
}

interface Models {
  premium: string;
  cheap: string;
}

function modelsFor(provider: Provider): Models {
  if (provider === "anthropic") return { premium: "claude-sonnet-4-6", cheap: "claude-haiku-4-5" };
  if (provider === "gemini") return { premium: "gemini-2.5-pro", cheap: "gemini-2.5-flash" };
  return { premium: "gpt-5", cheap: "gpt-5-mini" };
}

export function buildProfiles(provider: Provider): Profile[] {
  let { premium, cheap } = modelsFor(provider);
  // BENCH_MODEL holds the model constant across ALL profiles, so a single lever (e.g. retrieval
  // A0→A2) is isolated cleanly and we don't spend scarce premium-tier free quota.
  if (process.env.BENCH_MODEL) {
    premium = process.env.BENCH_MODEL;
    cheap = process.env.BENCH_MODEL;
  }
  const base = { provider, escalation: false } as const;
  // Each rung moves EXACTLY ONE lever from the previous, so the waterfall is attributable.
  return [
    {
      ...base,
      id: "A0",
      label: "Baseline (raw grep/read + premium, no cache)",
      model: premium,
      caching: false,
      retrieval: false,
      compressOutput: false,
      terse: false,
      note: "What an agent does today.",
    },
    {
      ...base,
      id: "A1",
      label: "+ prompt caching",
      model: premium,
      caching: true,
      retrieval: false,
      compressOutput: false,
      terse: false,
    },
    {
      ...base,
      id: "A2",
      label: "+ compact retrieval (replace grep/read)",
      model: premium,
      caching: true,
      retrieval: true,
      compressOutput: false,
      terse: false,
    },
    {
      ...base,
      id: "A3",
      label: "+ test-output compression (failures-only)",
      model: premium,
      caching: true,
      retrieval: true,
      compressOutput: true,
      terse: false,
      note: "Custom failures-only test-log trim (rtk's principle; rtk has no bun-test parser).",
    },
    {
      ...base,
      id: "A4",
      label: "+ terse output",
      model: premium,
      caching: true,
      retrieval: true,
      compressOutput: true,
      terse: true,
      note: "Isolates the terse-output lever (model still premium).",
    },
    {
      ...base,
      id: "A5",
      label: "+ cheap-model routing (price effect)",
      model: cheap,
      caching: true,
      retrieval: true,
      compressOutput: true,
      terse: true,
      note: "Isolates the model swap. A5→A4 delta is a per-token PRICE effect, not token efficiency. Inert if BENCH_MODEL pins one model.",
    },
  ];
}
