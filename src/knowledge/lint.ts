// Integrity checks over the store — the foundation subset (tasks.md T011):
//
//   - a record that does not parse, or fails validation, is a finding: reported, never skipped
//     (data-model §2.8 rule 4);
//   - parse → re-serialise must be byte-identical (data-model §2.8 rule 3);
//   - an existing record file may change only by a conforming redaction, and may not be deleted
//     (FR-007, FR-034);
//   - the same ULID in both inbox/ and records/ (data-model §1), and anything in a store directory
//     that is not a `<ULID>.md` file (FR-041);
//   - drafts waiting are information, never a finding (FR-050).
//
// The PR flags of US5 (FR-015, FR-016, FR-018, FR-039) extend this file later. Everything here
// reads the snapshot once; nothing re-reads the store per file.

import { canonicalIssue, parseRecordText, validateRecord } from "./record";
import { git } from "./platform";
import { STORE_DIR, type StoreSnapshot } from "./store";

export interface Finding {
  check: "parse" | "invalid" | "canonical" | "immutable" | "duplicate" | "layout";
  path: string;
  field?: string;
  message: string;
}

export interface LintInfo {
  draftsWaiting: number;
  /** Why the immutability check did not run, when it did not. Never silent (Principle II). */
  immutabilityNotChecked?: string;
}

export interface LintResult {
  findings: Finding[];
  info: LintInfo;
}

/** The record files that differ from the base revision, and a way to read their base version. */
export interface Base {
  changes: { path: string; status: "modified" | "deleted" }[];
  read(path: string): string | null;
}

export function lintStore(snapshot: StoreSnapshot, base?: Base | string): LintResult {
  const findings: Finding[] = [];
  let draftsWaiting = 0;
  const byId = new Map<string, Set<string>>();

  for (const s of snapshot.strays) findings.push({ check: "layout", path: s.path, message: s.reason });

  for (const e of snapshot.entries) {
    const areas = byId.get(e.id) ?? new Set();
    areas.add(e.area);
    byId.set(e.id, areas);
    if (e.area === "inbox") {
      draftsWaiting++;
      continue;
    }
    if (!e.parsed.ok) {
      for (const i of e.parsed.issues) findings.push({ check: "parse", path: e.path, field: i.field, message: i.message });
      continue;
    }
    for (const i of e.parsed.issues) findings.push({ check: "invalid", path: e.path, field: i.field, message: i.message });
    const c = canonicalIssue(e.text);
    if (c) findings.push({ check: "canonical", path: e.path, field: c.field, message: c.message });
  }

  for (const [id, areas] of byId)
    if (areas.size > 1)
      findings.push({
        check: "duplicate",
        path: `${STORE_DIR}/inbox/${id}.md`,
        message: `${id} is both a draft and a record — an acceptance did not complete, or a draft was copied rather than moved; the record is authoritative`,
      });

  const info: LintInfo = { draftsWaiting };
  if (typeof base === "string") info.immutabilityNotChecked = base;
  else if (base) findings.push(...immutability(snapshot, base));
  else info.immutabilityNotChecked = "no base revision was given";

  findings.sort((a, b) => cmp(a.path, b.path) || cmp(a.check, b.check) || cmp(a.field ?? "", b.field ?? ""));
  return { findings, info };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function immutability(snapshot: StoreSnapshot, base: Base): Finding[] {
  const out: Finding[] = [];
  const now = new Map(snapshot.entries.filter((e) => e.area === "records").map((e) => [e.path, e.text]));
  for (const { path, status } of base.changes) {
    if (!path.endsWith(".md")) continue;
    const before = base.read(path);
    if (before === null) continue;
    const after = status === "deleted" ? undefined : now.get(path);
    if (after === undefined) {
      out.push({
        check: "immutable",
        path,
        message: "a record was deleted — records are superseded or redacted, never removed (FR-007)",
      });
      continue;
    }
    if (after === before) continue;
    const why = redactionProblem(before, after);
    if (why) out.push({ check: "immutable", path, message: `changed after acceptance: ${why} (FR-034)` });
  }
  return out;
}

/** Null when `after` differs from `before` only as a conforming redaction (FR-033). */
export function redactionProblem(before: string, after: string): string | null {
  const a = parseRecordText(before);
  const b = parseRecordText(after);
  if (!a.ok || !b.ok) return "the change cannot be read as a redaction";
  if (validateRecord(b.data, b.body).length) return "the changed record does not validate";
  const red = b.data.redaction as { fields?: unknown } | undefined;
  if (!red || !Array.isArray(red.fields)) return "only a redaction may change a record, and this change carries no redaction metadata";
  const allowed = new Set(red.fields as string[]);
  const keys = new Set([...Object.keys(a.data), ...Object.keys(b.data)]);
  keys.delete("redaction");
  const changed = [...keys].filter((k) => JSON.stringify(a.data[k]) !== JSON.stringify(b.data[k]));
  if (a.body !== b.body) changed.push("body");
  const unlisted = changed.filter((k) => !allowed.has(k)).sort();
  if (unlisted.length) return `${unlisted.join(", ")} changed but ${unlisted.length > 1 ? "are" : "is"} not listed in redaction.fields`;
  return null;
}

/**
 * The working tree's record files compared with `rev` (default HEAD). One `git diff` lists what
 * changed, and only those files are read, so the cost follows the change, not the store's size.
 * Returns a reason string instead when there is nothing to compare against, so the caller can say
 * so rather than report a clean result it never checked.
 */
export function gitBase(root: string, rev = "HEAD"): Base | string {
  const inside = git(["rev-parse", "--is-inside-work-tree"], root);
  if (inside.code !== 0) return "not a git repository";
  const verify = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], root);
  if (verify.code !== 0) return `${rev} does not name a commit yet`;
  const diff = git(["diff", "--name-status", "--no-renames", rev, "--", `${STORE_DIR}/records/`], root);
  if (diff.code !== 0) return `could not compare ${STORE_DIR}/records/ with ${rev}: ${diff.stderr.trim()}`;
  const changes: Base["changes"] = [];
  for (const line of diff.stdout.split("\n")) {
    const [status, path] = line.split("\t");
    if (!path) continue;
    if (status === "M") changes.push({ path, status: "modified" });
    else if (status === "D") changes.push({ path, status: "deleted" });
  }
  return {
    changes,
    read(path) {
      const r = git(["show", `${rev}:${path}`], root);
      return r.code === 0 ? r.stdout : null;
    },
  };
}
