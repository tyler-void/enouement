// Per-model pricing, USD per 1M tokens.
//
// ⚠️ APPROXIMATE / VERIFY before quoting in the pitch. Rates move; confirm against the
// provider's live pricing page and (for Copilot) the AI-Credit multiplier table at
// https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
// `cachedRead` is the cache-hit input rate (~10% of input on most providers).
// `cacheWrite` is the one-time cache-creation rate (Anthropic only; ~1.25x input for 5-min TTL).

export interface ModelPrice {
  input: number; // per 1M input tokens
  cachedRead: number; // per 1M cached (read) input tokens
  cacheWrite: number; // per 1M cache-creation tokens
  output: number; // per 1M output tokens
}

// Keys are the model id strings used in profiles.ts.
export const PRICING: Record<string, ModelPrice> = {
  // Anthropic (illustrative 2026 rates)
  "claude-haiku-4-5": { input: 1.0, cachedRead: 0.1, cacheWrite: 1.25, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, cachedRead: 0.3, cacheWrite: 3.75, output: 15.0 },
  "claude-opus-4-8": { input: 15.0, cachedRead: 1.5, cacheWrite: 18.75, output: 75.0 },

  // OpenAI (illustrative)
  "gpt-5-mini": { input: 0.25, cachedRead: 0.025, cacheWrite: 0.25, output: 2.0 },
  "gpt-5": { input: 1.25, cachedRead: 0.125, cacheWrite: 1.25, output: 10.0 },

  // Google Gemini (illustrative paid rates; free tier = $0 but we cost-model at paid rates).
  // Note: Gemini caching is implicit and may not report cached_tokens via the OpenAI-compat
  // endpoint, so the A1 caching lever may read 0 on Gemini — use Anthropic for caching numbers.
  "gemini-2.5-flash": { input: 0.3, cachedRead: 0.075, cacheWrite: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, cachedRead: 0.3125, cacheWrite: 1.25, output: 10.0 },
};

export function priceFor(model: string): ModelPrice {
  const p = PRICING[model];
  if (!p) throw new Error(`No pricing for model "${model}". Add it to config/pricing.ts.`);
  return p;
}
