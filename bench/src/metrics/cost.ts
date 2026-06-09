import { priceFor } from "../../config/pricing";
import type { Usage } from "../types";

/** Convert a token Usage breakdown into USD for a given model. */
export function costUSD(usage: Usage, model: string): number {
  const p = priceFor(model);
  return (
    (usage.input * p.input +
      usage.cachedRead * p.cachedRead +
      usage.cacheWrite * p.cacheWrite +
      usage.output * p.output) /
    1_000_000
  );
}

export function totalTokens(u: Usage): number {
  return u.input + u.cachedRead + u.cacheWrite + u.output;
}
