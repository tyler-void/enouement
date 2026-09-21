// Minimal client for TypeSafe's System One API (model: Jev). No SDK — one fetch.
// Contract (docs.typesafe.ai/api): POST {model, state, questions} → answers[id].noul ∈ [0,1].
//
// OPT-IN ONLY. Every call sends workspace content (query + code chunks) to a hosted US API
// with closed weights. eco-mcp operates on whatever ECO_WORKSPACE points at — possibly a
// client repo — so a globally exported API key must NOT be enough to turn this on.
// Enable per workspace in that project's .mcp.json: ECO_JEV=on + TYPESAFE_API_KEY.
//
// `Decider` is the seam: swap in a self-hosted System-One-style model later without touching
// the rerank logic.

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface NoulResult {
  probs: Record<string, number>;
  inputTokens: number;
  ms: number;
}

export interface Decider {
  readonly id: string;
  /** P(yes) per question id — or null on ANY failure; callers must fall back, never guess. */
  noul(state: unknown, questions: Record<string, NoulQuestion>): Promise<NoulResult | null>;
}

const log = (...a: unknown[]) => console.error("[eco-mcp:jev]", ...a); // stdout is the MCP channel

export interface TypeSafeConfig {
  apiKey: string;
  url: string;
  model: string;
  timeoutMs: number;
}

export class TypeSafeDecider implements Decider {
  constructor(private cfg: TypeSafeConfig) {}
  get id(): string {
    return this.cfg.model;
  }

  async noul(state: unknown, questions: Record<string, NoulQuestion>): Promise<NoulResult | null> {
    const t0 = performance.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(this.cfg.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.cfg.model, state, questions }),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
        if ((res.status === 429 || res.status === 529) && attempt === 0) {
          await Bun.sleep(300); // one short retry; the tool must stay interactive
          continue;
        }
        if (!res.ok) {
          log(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return null;
        }
        const body: any = await res.json();
        const probs: Record<string, number> = {};
        for (const id of Object.keys(questions)) {
          const p = body?.answers?.[id]?.noul;
          if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
            log(`malformed answer for "${id}": ${JSON.stringify(body?.answers?.[id])}`);
            return null;
          }
          probs[id] = p;
        }
        return { probs, inputTokens: Number(body?.usage?.input_tokens ?? 0), ms: performance.now() - t0 };
      } catch (e) {
        log(`request failed: ${(e as Error).name}: ${(e as Error).message}`);
        return null;
      }
    }
    return null;
  }
}

/** null unless explicitly enabled AND keyed. Model is pinned by default: `jev-latest` drifts. */
export function deciderFromEnv(env: Record<string, string | undefined> = process.env): Decider | null {
  if (env.ECO_JEV !== "on") return null;
  if (!env.TYPESAFE_API_KEY) {
    log("ECO_JEV=on but TYPESAFE_API_KEY is empty — rerank disabled");
    return null;
  }
  return new TypeSafeDecider({
    apiKey: env.TYPESAFE_API_KEY,
    url: env.ECO_JEV_URL ?? "https://api.typesafe.ai/v1/systemone",
    model: env.ECO_JEV_MODEL ?? "jev-1.13.0",
    timeoutMs: Number(env.ECO_JEV_TIMEOUT_MS ?? 3000),
  });
}
