// The current-truth view and the full log of a module (FR-012–FR-014, FR-027–FR-027d, FR-040,
// FR-041, data-model §2.5).
//
// A deterministic projection of the records, never authored and never synthesised:
//   - current records only (superseded ones live in the log);
//   - ranked by kind priority — invariant, gotcha, convention, decision — then id, newest first,
//     keeping the top N of the module's limits (FR-027a); ids are unique, so the order is total;
//   - displayed grouped by kind in that order, with no heading for a kind that has none (FR-027b);
//   - an overflow line only when something was left out, naming the command for the full log
//     (FR-027c);
//   - a redacted summary keeps its place as "[redacted]" with its id (FR-027d).
// Module membership is computed here from the declarations in force, `formerly` included (FR-041).
// The same records always render the same bytes (FR-032, SC-011).

import { staticPrefix } from "./capture";
import { resolveModule, type ModuleDecl, type ModulesConfig } from "./modules";
import type { Kind } from "./record";
import { statusOf, type Known, type TrustView } from "./trust";
import { orderBySupersession } from "./why";

export const KIND_PRIORITY: readonly Kind[] = ["invariant", "gotcha", "convention", "decision"];

export interface ViewEntry {
  id: string;
  kind: Kind;
  summary: string;
  date: string;
  status: "current" | "superseded" | "draft";
  supersededBy: string[];
}

export interface ModuleView {
  module: string;
  /** Current records shown, in display order (grouped by kind priority, newest first within a kind). */
  shown: ViewEntry[];
  /** Current records left out by the limit. */
  omitted: number;
  /** Every record of the module, current or superseded. */
  total: number;
  drafts: ViewEntry[];
}

/** The declared module a record belongs to: the first of its paths that resolves, in path order. */
export function modulesOfRecord(modules: ModulesConfig, k: Known): Set<string> {
  const out = new Set<string>();
  for (const p of k.front.paths) {
    const m = resolveModule(modules, staticPrefix(p) || p);
    if (m) out.add(m.module.path);
  }
  return out;
}

export function findModule(modules: ModulesConfig, path: string): ModuleDecl | undefined {
  const p = path.endsWith("/") ? path.slice(0, -1) : path;
  return modules.modules.find((m) => m.path === p);
}

function entry(trust: TrustView, id: string, k: Known): ViewEntry {
  const s = statusOf(trust, id);
  return {
    id,
    kind: k.front.kind,
    summary: k.front.summary,
    date: k.front.provenance.date,
    status: s.status === "superseded" ? "superseded" : s.status === "draft" ? "draft" : "current",
    supersededBy: s.status === "superseded" ? s.by : [],
  };
}

const byKindThenNewest = (a: ViewEntry, b: ViewEntry) =>
  KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function moduleView(trust: TrustView, modules: ModulesConfig, module: ModuleDecl, opts: { unbounded?: boolean } = {}): ModuleView {
  const all: ViewEntry[] = [];
  for (const [id, k] of trust.records) if (modulesOfRecord(modules, k).has(module.path)) all.push(entry(trust, id, k));
  const current = all.filter((e) => e.status === "current").sort(byKindThenNewest);
  const limit = opts.unbounded ? Infinity : module.view.max_records;
  const shown = current.slice(0, limit);
  const drafts: ViewEntry[] = [];
  for (const [id, k] of trust.drafts) if (modulesOfRecord(modules, k).has(module.path)) drafts.push(entry(trust, id, k));
  drafts.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { module: module.path, shown, omitted: current.length - shown.length, total: all.length, drafts };
}

/** The view as text. Empty string when the module has no records at all — nothing to inject. */
export function renderView(v: ModuleView, opts: { includeDrafts?: boolean } = {}): string {
  if (v.total === 0 && !(opts.includeDrafts && v.drafts.length)) return "";
  const lines: string[] = [];
  if (!v.shown.length && v.total) lines.push(`${v.module} — no current truth recorded: every record has been superseded (enou log ${v.module})`);
  else if (v.shown.length) {
    lines.push(`${v.module} — current truth`);
    for (const kind of KIND_PRIORITY) {
      const of = v.shown.filter((e) => e.kind === kind);
      if (!of.length) continue;
      lines.push(`${kind}`);
      for (const e of of) lines.push(`  ${e.id}  ${e.summary}`);
    }
    if (v.omitted > 0)
      lines.push(`… ${v.omitted} more current record${v.omitted === 1 ? "" : "s"} not shown — full log: enou log ${v.module}`);
  }
  if (opts.includeDrafts && v.drafts.length) {
    lines.push(`drafts — NOT knowledge until a person accepts them`);
    for (const e of v.drafts) lines.push(`  ${e.id}  ${e.kind}  ${e.summary}`);
  }
  return lines.join("\n");
}

/** The full log: every record of the module, superseded ones marked, oldest first along the chain. */
export function renderLog(trust: TrustView, modules: ModulesConfig, module: ModuleDecl, opts: { includeDrafts?: boolean } = {}): string {
  const items: (ViewEntry & { front: { supersedes?: string } })[] = [];
  for (const [id, k] of trust.records)
    if (modulesOfRecord(modules, k).has(module.path)) items.push({ ...entry(trust, id, k), front: { supersedes: k.front.supersedes } });
  const lines = [`${module.path} — full log, ${items.length} record${items.length === 1 ? "" : "s"}, oldest first`];
  for (const e of orderBySupersession(items))
    lines.push(`  ${e.id}  ${e.date}  ${e.kind}${e.status === "superseded" ? `  [superseded by ${e.supersededBy.join(", ")}]` : ""}\n    ${e.summary}`);
  if (opts.includeDrafts) {
    const v = moduleView(trust, modules, module);
    if (v.drafts.length) {
      lines.push(`drafts — NOT knowledge until a person accepts them`);
      for (const e of v.drafts) lines.push(`  ${e.id}  ${e.kind}  ${e.summary}`);
    }
  }
  return lines.join("\n");
}
