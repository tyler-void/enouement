// The pre-work brief (FR-011, FR-048, contracts/cli.md `enou brief`).
//
// For the paths a piece of work will touch: the records affecting them (the `why` answer for each,
// deduplicated by id), the current-truth view of each declared module they fall in, and the gaps
// around them. A deterministic projection — no ranking, no model: the same records and paths give
// the same bytes. It always lists the checks it ran, so an empty gap list means "checked and
// clean", never "not looked at"; a check that has not run is absent from `checked`, not reported
// as clean.
//
// Drafts are never presented as knowledge here (FR-045): without `includeDrafts`, a waiting draft
// appears only as a `drafts-waiting` gap naming its id and paths — never its content.

import { staticPrefix } from "./capture";
import { resolveModule, type ModuleDecl, type ModulesConfig } from "./modules";
import type { Issue } from "./record";
import type { StoreSnapshot } from "./store";
import { buildTrust, type TrustView } from "./trust";
import { moduleView, renderView } from "./view";
import { orderBySupersession, whyPath, type WhyOptions, type WhyRecord } from "./why";

/** The checks a brief runs today, in the order they are reported. */
export const BRIEF_CHECKS = ["uncovered-path", "module-without-knowledge", "drafts-waiting"] as const;

export interface BriefGap {
  check: string;
  path?: string;
  module?: string;
  id?: string;
  detail: string;
}

export interface BriefView {
  module: string;
  text: string;
  shown: number;
  omitted: number;
  total: number;
}

/** A further check added by a later increment (US5: contradictions, dangling references). */
export interface BriefCheck {
  name: string;
  run(input: { trust: TrustView; modules: ModulesConfig; paths: readonly string[]; records: readonly WhyRecord[] }): BriefGap[];
}

export interface Brief {
  paths: string[];
  records: WhyRecord[];
  /** Only with `includeDrafts`, each labelled a draft. */
  drafts: WhyRecord[];
  views: BriefView[];
  gaps: BriefGap[];
  checked: string[];
  unreadable: { path: string; issues: Issue[] }[];
}

function mergeInto(map: Map<string, WhyRecord>, r: WhyRecord) {
  const seen = map.get(r.id);
  if (!seen) map.set(r.id, { ...r, matchedBy: [...r.matchedBy] });
  else for (const m of r.matchedBy) if (!seen.matchedBy.includes(m)) seen.matchedBy.push(m);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function brief(
  root: string,
  snapshot: StoreSnapshot,
  modules: ModulesConfig,
  paths: readonly string[],
  opts: WhyOptions & { checks?: readonly BriefCheck[] } = {},
): Brief {
  const asked = [...new Set(paths)];
  const trust = buildTrust(snapshot);
  const records = new Map<string, WhyRecord>();
  const drafts = new Map<string, WhyRecord>();
  for (const p of asked) {
    const a = whyPath(root, snapshot, modules, p, { ...opts, includeDrafts: true });
    for (const r of a.records) mergeInto(records, r);
    for (const d of a.drafts) mergeInto(drafts, d);
  }
  const orderedRecords = orderBySupersession([...records.values()]);
  const orderedDrafts = [...drafts.values()].sort((a, b) => cmp(a.id, b.id));

  const gaps: BriefGap[] = [];
  const touched = new Map<string, ModuleDecl>();
  for (const p of asked) {
    const m = resolveModule(modules, staticPrefix(p) || p);
    if (m) touched.set(m.module.path, m.module);
    else
      gaps.push({
        check: "uncovered-path",
        path: p,
        detail: "belongs to no declared module, so it gets no view and raises no flags (enou modules add <path>)",
      });
  }

  const views: BriefView[] = [];
  for (const module of [...touched.values()].sort((a, b) => cmp(a.path, b.path))) {
    const v = moduleView(trust, modules, module);
    if (v.total === 0)
      gaps.push({ check: "module-without-knowledge", module: module.path, detail: "no records yet" });
    else {
      if (!v.shown.length)
        gaps.push({
          check: "module-without-knowledge",
          module: module.path,
          detail: "every record is superseded — no current truth recorded",
        });
      views.push({ module: module.path, text: renderView(v), shown: v.shown.length, omitted: v.omitted, total: v.total });
    }
  }

  for (const d of orderedDrafts)
    gaps.push({
      check: "drafts-waiting",
      id: d.id,
      path: d.front.paths.join(", "),
      detail: `a draft waiting for a person to read and accept or reject (enou drafts; enou accept ${d.id})`,
    });

  const extra = opts.checks ?? [];
  for (const c of extra) gaps.push(...c.run({ trust, modules, paths: asked, records: orderedRecords }));

  const checked = [...BRIEF_CHECKS, ...extra.map((c) => c.name)];
  const rank = (g: BriefGap) => checked.indexOf(g.check);
  gaps.sort((a, b) => rank(a) - rank(b) || cmp(a.path ?? a.module ?? "", b.path ?? b.module ?? "") || cmp(a.id ?? "", b.id ?? ""));

  return {
    paths: asked,
    records: orderedRecords,
    drafts: opts.includeDrafts ? orderedDrafts : [],
    views,
    gaps,
    checked,
    unreadable: trust.invalid,
  };
}
