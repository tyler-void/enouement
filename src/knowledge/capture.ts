// Building a draft from what a person or an agent supplies (FR-043, contracts/cli.md `enou record`).
// Every capture path ends here and in store.writeDraft: there is no path that writes a record.

import { newUlid } from "./id";
import { resolveModule, type ModulesConfig } from "./modules";
import type { Kind, Origin } from "./record";

export interface DraftInput {
  kind: Kind;
  summary: string;
  paths: string[];
  body: string;
  symbols?: string[];
  rejected?: string[];
  supersedes?: string;
  origin?: Origin;
  source?: string;
  spec?: string;
  commits?: string[];
}

/** Today's date where the capture happens, as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const GLOB_CHARS = /[*?[\]{}]/;

/** The part of a path or glob before any glob character, without a trailing slash. */
export function staticPrefix(p: string): string {
  const at = p.search(GLOB_CHARS);
  const head = at < 0 ? p : p.slice(0, p.lastIndexOf("/", at) + 1);
  return head.endsWith("/") ? head.slice(0, -1) : head;
}

/**
 * The summary cap that applies to a record about `paths` (FR-013, FR-031): the strictest cap of the
 * modules it falls in, so its summary fits every view it can appear in. Paths in no module use the
 * defaults.
 */
export function summaryCap(config: ModulesConfig, paths: readonly string[]): number {
  let cap = Infinity;
  for (const p of paths) {
    const prefix = staticPrefix(p);
    const m = prefix ? resolveModule(config, prefix) : null;
    cap = Math.min(cap, m ? m.module.view.max_summary : config.defaults.max_summary);
  }
  return Number.isFinite(cap) ? cap : config.defaults.max_summary;
}

/** Front matter for a new draft. Optional fields that were not given are left out entirely. */
export function draftData(input: DraftInput, opts: { id?: string; date?: string } = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: opts.id ?? newUlid(),
    kind: input.kind,
    summary: input.summary,
    provenance: {
      origin: input.origin ?? "contemporaneous",
      ...(input.source !== undefined ? { source: input.source } : {}),
      date: opts.date ?? today(),
    },
    paths: input.paths,
  };
  if (input.symbols?.length) data.symbols = input.symbols;
  if (input.spec !== undefined) data.spec = input.spec;
  if (input.commits?.length) data.commits = input.commits;
  if (input.supersedes !== undefined) data.supersedes = input.supersedes;
  if (input.rejected?.length) data.rejected = input.rejected;
  return data;
}
