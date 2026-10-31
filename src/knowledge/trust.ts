// The one predicate that decides what counts as knowledge (data-model §2.2, plan.md binding test
// #14). Every read path — why, view, log, the read hook, brief, recall — and the supersession
// computation itself go through here and nowhere else: two notions of "trusted" in two code paths
// is how an untrusted file ends up hiding a trusted one.
//
// A file is knowledge iff it is in records/, parses, and validates. Drafts are never knowledge; a
// draft that names a record in `supersedes` changes nothing until it is accepted (FR-045). A
// record that fails validation is not silently trusted and not silently dropped: it is listed in
// `invalid`, so every read path can report it (data-model §2.8 rule 4).

import type { FrontMatter, Issue } from "./record";
import type { StoreEntry, StoreSnapshot } from "./store";

export interface Known {
  front: FrontMatter;
  body: string;
  path: string;
}

export interface TrustView {
  /** Accepted, parseable, valid records, by id. */
  records: Map<string, Known>;
  /** Drafts that parse and validate, by id — never knowledge. A draft whose id is also a record is
   *  left out here and reported by lint (data-model §1). */
  drafts: Map<string, Known>;
  /** Record id → the ids of the records that supersede it, in id order. More than one is a fork. */
  supersededBy: Map<string, string[]>;
  /** Files in records/ that do not parse or validate. Not knowledge, never hidden. */
  invalid: { path: string; issues: Issue[] }[];
}

export function isKnowledge(entry: StoreEntry): boolean {
  return entry.area === "records" && entry.parsed.ok && entry.parsed.issues.length === 0;
}

export function buildTrust(snapshot: StoreSnapshot): TrustView {
  const records = new Map<string, Known>();
  const drafts = new Map<string, Known>();
  const invalid: TrustView["invalid"] = [];
  for (const e of snapshot.entries) {
    if (!e.parsed.ok || e.parsed.issues.length) {
      if (e.area === "records") invalid.push({ path: e.path, issues: e.parsed.issues });
      continue;
    }
    const known: Known = { front: e.parsed.data as FrontMatter, body: e.parsed.body, path: e.path };
    (e.area === "records" ? records : drafts).set(e.id, known);
  }
  for (const id of records.keys()) drafts.delete(id);

  const supersededBy = new Map<string, string[]>();
  for (const [id, r] of [...records].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const target = r.front.supersedes;
    if (target === undefined || !records.has(target)) continue;
    const list = supersededBy.get(target) ?? [];
    list.push(id);
    supersededBy.set(target, list);
  }
  return { records, drafts, supersededBy, invalid };
}

export type Status =
  | { status: "current" }
  | { status: "superseded"; by: string[] }
  | { status: "draft" }
  | { status: "unknown" };

export function statusOf(view: TrustView, id: string): Status {
  if (view.records.has(id)) {
    const by = view.supersededBy.get(id);
    return by ? { status: "superseded", by } : { status: "current" };
  }
  return view.drafts.has(id) ? { status: "draft" } : { status: "unknown" };
}
