// Integrity checks — the whole of enforcement, in one place, so the local git hooks and CI cannot
// drift apart (contracts/cli.md `enou lint`, contracts/hooks.md §1).
//
// Store integrity (always, on the snapshot being checked):
//   - a record that does not parse, or fails validation, is a finding: reported, never skipped
//     (data-model §2.8 rule 4);
//   - parse → re-serialise must be byte-identical (data-model §2.8 rule 3);
//   - the same ULID in both inbox/ and records/ (data-model §1), and anything in a store directory
//     that is not a `<ULID>.md` file (FR-041).
// Against the change being checked (working tree vs HEAD, the index vs HEAD, or a commit range):
//   - an existing record may change only by a conforming redaction, and may not be deleted (FR-034);
//   - a record added under records/ must pass capture validation — acceptance is the only way in;
//   - a declared module whose code changed with neither an accepted record nor a `Knowledge-None:`
//     statement (FR-015) — judged per commit, so only in range mode;
//   - a reference the change left dangling: a path, a declared symbol, a stored commit (FR-016);
//   - a supersession fork — two current records superseding the same record (FR-018);
//   - a commit carrying both trailers (formats §3).
// Information — reported, never a failure: drafts waiting (FR-050), records a removed declaration
// un-covers (FR-039), current decisions on the same path that a new decision does not link to
// (FR-018), references that were already dangling before the change, and any check that could not
// run, with the reason (Principle II: never a clean result that was not checked).
//
// Every check reads the snapshot once; nothing re-reads the store per file, and the git work is a
// fixed number of processes plus one per changed symbol file, so cost follows the change.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { staticPrefix, summaryCap } from "./capture";
import { parseModules, PUBLISHED_DEFAULTS, resolveModule, type ModulesConfig } from "./modules";
import { git } from "./platform";
import { canonicalIssue, parseRecordText, parseSymbol, prepareRecord, validateRecord, type FrontMatter } from "./record";
import { loadStore, STORE_DIR, type StoreSnapshot } from "./store";
import { stillDefines } from "./symbols";
import { buildTrust, statusOf, type TrustView } from "./trust";
import { relates } from "./why";

export type Check =
  | "parse"
  | "invalid"
  | "canonical"
  | "immutable"
  | "duplicate"
  | "layout"
  | "unaccepted"
  | "unrecorded"
  | "dangling"
  | "contradiction"
  | "trailers";

export interface Finding {
  check: Check;
  path: string;
  field?: string;
  message: string;
}

export interface LintInfo {
  draftsWaiting: number;
  /** Drafts waiting, with the paths they touch (FR-050). */
  drafts: { id: string; paths: string[] }[];
  /** Why the immutability check did not run, when it did not. Never silent (Principle II). */
  immutabilityNotChecked?: string;
  /** Every other check that did not run, each with its reason. */
  notChecked: string[];
  /** Declarations removed by the change, with how many records they leave in no module (FR-039). */
  uncovered: { module: string; records: number }[];
  /** A new current decision on a path that already has a current decision it does not supersede. */
  unlinkedDecisions: { ids: [string, string]; path: string }[];
  /** References that were already dangling before the change — not the change's doing. */
  danglingBefore: { id: string; ref: string; reason: string }[];
}

export interface LintResult {
  findings: Finding[];
  info: LintInfo;
}

export function emptyInfo(): LintInfo {
  return { draftsWaiting: 0, drafts: [], notChecked: [], uncovered: [], unlinkedDecisions: [], danglingBefore: [] };
}

/** The record files that differ from the base revision, and a way to read their base version. */
export interface Base {
  changes: { path: string; status: "modified" | "deleted" }[];
  read(path: string): string | null;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortFindings(f: Finding[]): Finding[] {
  return f.sort((a, b) => cmp(a.path, b.path) || cmp(a.check, b.check) || cmp(a.field ?? "", b.field ?? "") || cmp(a.message, b.message));
}

// ---------------------------------------------------------------------------------------------
// Store integrity

export function lintStore(snapshot: StoreSnapshot, base?: Base | string): LintResult {
  const findings: Finding[] = [];
  const info = emptyInfo();
  const byId = new Map<string, Set<string>>();

  for (const s of snapshot.strays) findings.push({ check: "layout", path: s.path, message: s.reason });

  for (const e of snapshot.entries) {
    const areas = byId.get(e.id) ?? new Set();
    areas.add(e.area);
    byId.set(e.id, areas);
    if (e.area === "inbox") {
      info.draftsWaiting++;
      const d = e.parsed.ok ? e.parsed.data : {};
      info.drafts.push({ id: e.id, paths: Array.isArray(d.paths) ? (d.paths as unknown[]).map(String) : [] });
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

  if (typeof base === "string") info.immutabilityNotChecked = base;
  else if (base) findings.push(...immutability(snapshot, base));
  else info.immutabilityNotChecked = "no base revision was given";

  return { findings: sortFindings(findings), info };
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

// ---------------------------------------------------------------------------------------------
// The change being checked

export type Mode = { kind: "worktree" } | { kind: "staged" } | { kind: "range"; from: string; to: string };

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  /** For a rename, the old path. */
  from?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  files: string[];
}

/** A tree's paths: files, and every directory that contains one. */
export interface TreeView {
  has(path: string): boolean;
  /** The revision to read file contents at; undefined for the working tree or the index. */
  rev?: string;
}

export interface Change {
  mode: Mode["kind"];
  /** The revision the change is measured from; null when there is no commit to compare with. */
  baseRev: string | null;
  files: FileChange[];
  /** Range mode only: the commits in the range, merges excluded. */
  commits: CommitInfo[];
  base: TreeView;
  head: TreeView;
  readBase(path: string): string | null;
  /** The directory whose `.knowledge/` is the head state — the repository, or a temporary copy. */
  headRoot: string;
  cleanup(): void;
}

function treeView(paths: Iterable<string>, rev?: string): TreeView {
  const all = new Set<string>();
  for (const p of paths) {
    all.add(p);
    let i = p.lastIndexOf("/");
    while (i > 0) {
      const dir = p.slice(0, i);
      if (all.has(dir)) break;
      all.add(dir);
      i = dir.lastIndexOf("/");
    }
  }
  return { has: (p) => all.has(p.endsWith("/") ? p.slice(0, -1) : p), rev };
}

const Z = (s: string) => s.split("\0").filter(Boolean);

function parseNameStatusZ(out: string): FileChange[] {
  const parts = out.split("\0");
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) continue;
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const from = parts[i++]!;
      const to = parts[i++]!;
      files.push(kind === "R" ? { status: "R", path: to, from } : { status: "A", path: to });
    } else {
      const path = parts[i++]!;
      files.push({ status: kind === "D" ? "D" : kind === "A" ? "A" : "M", path });
    }
  }
  return files;
}

/** `Knowledge-None:` and `Knowledge-Record:` lines anywhere in a message — not only the trailer
 *  block, because a squash merge recomposes the message and can bury them (formats §3). Git's own
 *  squash message indents each original message by four spaces, and some tools list commits as
 *  `* …`, so leading space and a list marker are allowed. */
export function readTrailers(message: string): { none: string[]; records: string[] } {
  const none: string[] = [];
  const records: string[] = [];
  for (const line of message.split("\n")) {
    const n = /^[ \t]*(?:[*-][ \t]+)?Knowledge-None:[ \t]*(.*?)\s*$/i.exec(line);
    if (n) none.push(n[1]!);
    const r = /^[ \t]*(?:[*-][ \t]+)?Knowledge-Record:[ \t]*(.+?)\s*$/i.exec(line);
    if (r) records.push(...r[1]!.split(/[,\s]+/).filter(Boolean));
  }
  return { none, records };
}

function verifyCommit(root: string, rev: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], root);
  return r.code === 0 ? r.stdout.trim() : null;
}

function tmpStore(): string {
  return mkdtempSync(join(tmpdir(), "enou-lint-"));
}

/** Collect the change to check, or the reason it cannot be collected. */
export function collectChange(root: string, mode: Mode): Change | string {
  if (git(["rev-parse", "--is-inside-work-tree"], root).code !== 0) return "not a git repository";
  const head = verifyCommit(root, "HEAD");
  const noop = () => {};

  if (mode.kind === "range") {
    const from = verifyCommit(root, mode.from);
    const to = verifyCommit(root, mode.to);
    if (!from) return `${mode.from} does not name a commit`;
    if (!to) return `${mode.to} does not name a commit`;
    const mb = git(["merge-base", from, to], root);
    const baseRev = mb.code === 0 ? mb.stdout.trim() : from;
    const diff = git(["-c", "core.quotePath=false", "diff", "--name-status", "-z", "-M", baseRev, to], root);
    if (diff.code !== 0) return `could not diff ${mode.from}...${mode.to}: ${diff.stderr.trim()}`;
    const log = git(
      ["-c", "core.quotePath=false", "log", "--no-merges", "--format=%x1e%H%x1f%B%x1f", "--name-only", `${from}..${to}`],
      root,
    );
    if (log.code !== 0) return `could not read the commits in ${mode.from}..${mode.to}: ${log.stderr.trim()}`;
    const commits: CommitInfo[] = [];
    for (const chunk of log.stdout.split("\x1e")) {
      if (!chunk.trim()) continue;
      const [sha, message, names] = chunk.split("\x1f");
      commits.push({ sha: sha!.trim(), message: message ?? "", files: (names ?? "").split("\n").map((s) => s.trim()).filter(Boolean) });
    }
    const headFiles = Z(git(["ls-tree", "-r", "-z", "--name-only", to], root).stdout);
    // The head's store: the working tree when it is that commit and the store is clean there,
    // otherwise a temporary copy read out of git.
    const clean = to === head && git(["diff", "--quiet", "HEAD", "--", STORE_DIR], root).code === 0;
    let headRoot = root;
    let cleanup = noop;
    if (!clean) {
      headRoot = tmpStore();
      for (const p of headFiles.filter((f) => f.startsWith(`${STORE_DIR}/`))) {
        const r = git(["show", `${to}:${p}`], root);
        if (r.code !== 0) continue;
        mkdirSync(dirname(join(headRoot, p)), { recursive: true });
        writeFileSync(join(headRoot, p), r.stdout);
      }
      const dir = headRoot;
      cleanup = () => rmSync(dir, { recursive: true, force: true });
    }
    return {
      mode: "range",
      baseRev,
      files: parseNameStatusZ(diff.stdout),
      commits: commits.reverse(),
      base: treeView(Z(git(["ls-tree", "-r", "-z", "--name-only", baseRev], root).stdout), baseRev),
      head: treeView(headFiles, to),
      readBase: (p) => {
        const r = git(["show", `${baseRev}:${p}`], root);
        return r.code === 0 ? r.stdout : null;
      },
      headRoot,
      cleanup,
    };
  }

  const readBase = (p: string) => {
    if (!head) return null;
    const r = git(["show", `HEAD:${p}`], root);
    return r.code === 0 ? r.stdout : null;
  };
  const base = treeView(head ? Z(git(["ls-tree", "-r", "-z", "--name-only", "HEAD"], root).stdout) : [], head ?? undefined);

  if (mode.kind === "staged") {
    const diff = git(["-c", "core.quotePath=false", "diff", "--cached", "--name-status", "-z", "-M"], root);
    if (diff.code !== 0) return `could not read the staged change: ${diff.stderr.trim()}`;
    const indexFiles = Z(git(["ls-files", "-z", "--cached"], root).stdout);
    // The index's store, copied out so the checks read exactly what will be committed.
    const headRoot = tmpStore();
    const storeFiles = indexFiles.filter((f) => f.startsWith(`${STORE_DIR}/`));
    for (let i = 0; i < storeFiles.length; i += 500) {
      const r = git(["checkout-index", "-f", `--prefix=${headRoot}/`, "--", ...storeFiles.slice(i, i + 500)], root);
      if (r.code !== 0) return `could not read the staged store: ${r.stderr.trim()}`;
    }
    return {
      mode: "staged",
      baseRev: head,
      files: parseNameStatusZ(diff.stdout),
      commits: [],
      base,
      head: treeView(indexFiles),
      readBase,
      headRoot,
      cleanup: () => rmSync(headRoot, { recursive: true, force: true }),
    };
  }

  // Working tree against HEAD, untracked files included.
  const diff = head
    ? git(["-c", "core.quotePath=false", "diff", "--name-status", "-z", "-M", "HEAD"], root)
    : { code: 0, stdout: "", stderr: "" };
  if (diff.code !== 0) return `could not compare the working tree with HEAD: ${diff.stderr.trim()}`;
  const tracked = Z(git(["ls-files", "-z", "--cached"], root).stdout);
  const untracked = Z(git(["ls-files", "-z", "--others", "--exclude-standard"], root).stdout);
  const files = parseNameStatusZ(diff.stdout);
  if (!head) files.push(...tracked.map((p): FileChange => ({ status: "A", path: p })));
  files.push(...untracked.map((p): FileChange => ({ status: "A", path: p })));
  return {
    mode: "worktree",
    baseRev: head,
    files,
    commits: [],
    base,
    head: treeView([...tracked.filter((p) => !files.some((f) => f.status === "D" && f.path === p)), ...untracked]),
    readBase,
    headRoot: root,
    cleanup: noop,
  };
}

// ---------------------------------------------------------------------------------------------
// FR-018 — contradictions, defined mechanically (data-model §2.2, "Contradictions")

export interface Contradiction {
  kind: "fork" | "unlinked-decisions";
  ids: string[];
  /** For a fork: the record both successors supersede. */
  target?: string;
  /** For unlinked decisions: the path both concern. */
  path?: string;
  message: string;
}

function overlap(a: FrontMatter, b: FrontMatter): string | null {
  for (const pa of a.paths) for (const pb of b.paths) if (relates(pa, pb) || relates(pb, pa)) return pa.length <= pb.length ? pb : pa;
  return null;
}

/**
 * Two kinds, both mechanical — nothing reads the prose:
 *   - a FORK: two or more CURRENT records supersede the same record. History says two different
 *     things replaced one truth; a person must make one supersede the other.
 *   - UNLINKED DECISIONS: two current decisions concern the same path and neither supersedes the
 *     other. Often they are about different aspects, so this is a prompt to link them if one
 *     replaces the other — not proof of a contradiction.
 * `ids` restricts unlinked-decision pairs to those involving these records (e.g. new ones);
 * `paths` restricts both kinds to records relating to these paths (for `brief`).
 */
export function contradictions(trust: TrustView, opts: { ids?: ReadonlySet<string>; paths?: readonly string[] } = {}): Contradiction[] {
  const out: Contradiction[] = [];
  const inScope = (f: FrontMatter) => !opts.paths || f.paths.some((p) => opts.paths!.some((q) => relates(p, q) || relates(q, p)));
  for (const [target, successors] of [...trust.supersededBy].sort(([a], [b]) => cmp(a, b))) {
    const current = successors.filter((s) => statusOf(trust, s).status === "current");
    if (current.length < 2) continue;
    if (!current.some((s) => inScope(trust.records.get(s)!.front))) continue;
    out.push({
      kind: "fork",
      ids: current,
      target,
      message: `${current.join(" and ")} both supersede ${target} and both are current — make one supersede the other (FR-018)`,
    });
  }
  const decisions = [...trust.records]
    .filter(([id, k]) => k.front.kind === "decision" && statusOf(trust, id).status === "current" && inScope(k.front))
    .sort(([a], [b]) => cmp(a, b));
  for (let i = 0; i < decisions.length; i++)
    for (let j = i + 1; j < decisions.length; j++) {
      const [a, ka] = decisions[i]!;
      const [b, kb] = decisions[j]!;
      if (opts.ids && !opts.ids.has(a) && !opts.ids.has(b)) continue;
      const path = overlap(ka.front, kb.front);
      if (!path) continue;
      out.push({
        kind: "unlinked-decisions",
        ids: [a, b],
        path,
        message: `${a} and ${b} are both current decisions about ${path}; if one replaces the other, supersede it`,
      });
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// FR-016 — dangling references

export interface Dangling {
  id: string;
  ref: string;
  kind: "path" | "symbol" | "commit";
  reason: string;
}

export interface DanglingOptions {
  /** Only these records. Default: every current record. */
  ids?: ReadonlySet<string>;
  /** Renames in the change: a reference to a renamed path is not dangling (FR-037, FR-038). */
  renames?: readonly FileChange[];
  /** Check declared symbols only in these files (each check is one `git grep`); "all" checks every one. */
  symbolFiles?: ReadonlySet<string> | "all";
  /** Check stored commits of these records exist. */
  commitIds?: ReadonlySet<string>;
  modules?: ModulesConfig;
}

function renamedAway(target: string, renames: readonly FileChange[] = []): boolean {
  return renames.some((r) => r.status === "R" && r.from !== undefined && (r.from === target || r.from.startsWith(target + "/")));
}

function viaFormerly(target: string, modules: ModulesConfig | undefined, head: TreeView): boolean {
  if (!modules) return false;
  const m = resolveModule(modules, target);
  if (!m || m.via !== "formerly" || /[*?[\]{}]/.test(m.pattern)) return false;
  return head.has(m.module.path + target.slice(m.pattern.length));
}

/** Current records' references that point at nothing in `head` (FR-016). */
export function danglingReferences(root: string, trust: TrustView, head: TreeView, opts: DanglingOptions = {}): Dangling[] {
  const out: Dangling[] = [];
  for (const [id, k] of [...trust.records].sort(([a], [b]) => cmp(a, b))) {
    if (opts.ids && !opts.ids.has(id)) continue;
    if (statusOf(trust, id).status !== "current") continue;
    for (const p of k.front.paths) {
      const target = /[*?[\]{}]/.test(p) ? staticPrefix(p) : p.endsWith("/") ? p.slice(0, -1) : p;
      if (target === "" || head.has(target)) continue;
      if (renamedAway(target, opts.renames) || viaFormerly(target, opts.modules, head)) continue;
      out.push({ id, ref: p, kind: "path", reason: `${target} no longer exists` });
    }
    for (const s of k.front.symbols ?? []) {
      const sym = parseSymbol(s);
      if (typeof sym === "string") continue;
      if (!head.has(sym.path)) {
        if (renamedAway(sym.path, opts.renames) || viaFormerly(sym.path, opts.modules, head)) continue;
        out.push({ id, ref: s, kind: "symbol", reason: `${sym.path} no longer exists` });
        continue;
      }
      const check = opts.symbolFiles === "all" || opts.symbolFiles?.has(sym.path);
      if (check && stillDefines(root, sym.path, sym.name, head.rev) === false)
        out.push({ id, ref: s, kind: "symbol", reason: `${sym.path} no longer defines ${sym.name}` });
    }
    if (opts.commitIds?.has(id))
      for (const c of k.front.commits ?? [])
        if (!verifyCommit(root, c)) out.push({ id, ref: c, kind: "commit", reason: `commit ${c} does not exist in this repository` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The full check of a change

function idFromRecordPath(p: string, area: "records" | "inbox"): string | null {
  const m = new RegExp(`^${STORE_DIR}/${area}/([0-9A-Z]{26})\\.md$`).exec(p);
  return m ? m[1]! : null;
}

function modulesAt(text: string | null): ModulesConfig | null {
  if (text === null) return null;
  const r = parseModules(text);
  return r.ok ? r.config : null;
}

function moduleOf(modules: ModulesConfig, p: string): string | null {
  return resolveModule(modules, staticPrefix(p) || p)?.module.path ?? null;
}

function recordModules(modules: ModulesConfig, f: FrontMatter): Set<string> {
  const out = new Set<string>();
  for (const p of f.paths) {
    const m = moduleOf(modules, p);
    if (m) out.add(m);
  }
  return out;
}

export function lintChange(root: string, change: Change): LintResult {
  const snapshot = loadStore(change.headRoot);
  const trust = buildTrust(snapshot);
  const modulesFile = join(change.headRoot, STORE_DIR, "modules.yaml");
  const headParsed = existsSync(modulesFile) ? parseModules(readFileSync(modulesFile, "utf8")) : null;
  const modules: ModulesConfig = headParsed?.ok ? headParsed.config : { defaults: { ...PUBLISHED_DEFAULTS }, modules: [] };

  // Store integrity and immutability.
  const recordChanges: Base["changes"] = [];
  for (const f of change.files) {
    const isRecord = (p?: string) => p !== undefined && idFromRecordPath(p, "records") !== null;
    if (f.status === "M" && isRecord(f.path)) recordChanges.push({ path: f.path, status: "modified" });
    if (f.status === "D" && isRecord(f.path)) recordChanges.push({ path: f.path, status: "deleted" });
    if (f.status === "R" && isRecord(f.from)) recordChanges.push({ path: f.from!, status: "deleted" });
  }
  const result = lintStore(snapshot, change.baseRev ? { changes: recordChanges, read: change.readBase } : "there is no commit to compare with yet");
  const findings = result.findings;
  const info = result.info;
  if (headParsed && !headParsed.ok)
    for (const i of headParsed.issues) findings.push({ check: "invalid", path: `${STORE_DIR}/modules.yaml`, field: i.field, message: i.message });

  // Records that arrived in this change.
  const added = new Set<string>();
  for (const f of change.files) {
    const id = idFromRecordPath(f.path, "records");
    if (id && (f.status === "A" || (f.status === "R" && f.from !== f.path))) added.add(id);
  }

  // A record added under records/ must pass capture validation: acceptance is the only way in.
  for (const id of added) {
    const e = snapshot.entries.find((x) => x.area === "records" && x.id === id);
    if (!e || !e.parsed.ok) continue; // parse failures are already findings
    const paths = Array.isArray(e.parsed.data.paths) ? (e.parsed.data.paths as string[]) : [];
    const prepared = prepareRecord(e.parsed.data, e.parsed.body, { maxSummary: summaryCap(modules, paths) });
    if (!prepared.ok)
      for (const i of prepared.issues)
        findings.push({
          check: "unaccepted",
          path: e.path,
          field: i.field,
          message: `${i.message} — a record must enter through \`enou accept\`, which would have refused it`,
        });
  }

  // FR-016: references the change left dangling are findings; older ones are information.
  const changedPaths = new Set(change.files.flatMap((f) => [f.path, ...(f.from ? [f.from] : [])]));
  const dangling = danglingReferences(root, trust, change.head, {
    renames: change.files,
    symbolFiles: change.mode === "worktree" && !change.baseRev ? "all" : changedPaths,
    commitIds: added,
    modules,
  });
  for (const d of dangling) {
    const target =
      d.kind === "symbol" ? (parseSymbol(d.ref) as { path: string }).path : /[*?[\]{}]/.test(d.ref) ? staticPrefix(d.ref) : d.ref.replace(/\/$/, "");
    const introduced = d.kind === "commit" || added.has(d.id) || change.base.has(target) || (d.kind === "symbol" && changedPaths.has(target));
    if (introduced)
      findings.push({
        check: "dangling",
        path: trust.records.get(d.id)!.path,
        field: d.kind === "path" ? "paths" : d.kind === "symbol" ? "symbols" : "commits",
        message: `${d.ref}: ${d.reason} — supersede the record with one that points at what replaced it, or restore it (FR-016)`,
      });
    else info.danglingBefore.push({ id: d.id, ref: d.ref, reason: d.reason });
  }

  // FR-018: forks are findings; unlinked decisions involving a new decision are information.
  for (const c of contradictions(trust, { ids: added })) {
    if (c.kind === "fork")
      findings.push({ check: "contradiction", path: trust.records.get(c.ids[0]!)!.path, field: "supersedes", message: c.message });
    else info.unlinkedDecisions.push({ ids: [c.ids[0]!, c.ids[1]!], path: c.path! });
  }

  // FR-039: a removed declaration and the records it leaves in no module.
  const baseModulesText = change.readBase(`${STORE_DIR}/modules.yaml`);
  const baseModules = modulesAt(baseModulesText);
  if (baseModules)
    for (const m of baseModules.modules) {
      if (modules.modules.some((x) => x.path === m.path || x.formerly.includes(m.path))) continue;
      let n = 0;
      for (const [, k] of trust.records)
        if (recordModules(baseModules, k.front).has(m.path) && recordModules(modules, k.front).size === 0) n++;
      info.uncovered.push({ module: m.path, records: n });
    }

  // FR-015 and the trailers: judged per commit, so only over a range of commits.
  if (change.mode !== "range")
    info.notChecked.push(
      "FR-015 (a module changed with no knowledge) is judged from commit messages, so it runs over a commit range: enou lint --range <base>..HEAD (the pre-push hook and CI do this)",
    );
  else findings.push(...unrecorded(change, trust, modules));

  return { findings: sortFindings(findings), info };
}

function unrecorded(change: Change, trust: TrustView, modules: ModulesConfig): Finding[] {
  const out: Finding[] = [];
  const touches = new Map<string, Set<string>>(); // module → commits touching its code
  const noneAnywhere: string[] = []; // commits with Knowledge-None that touch no code
  const noneBy = new Set<string>(); // commits carrying Knowledge-None
  const trailerRecords = new Set<string>();
  for (const c of change.commits) {
    const t = readTrailers(c.message);
    if (t.none.length && t.records.length)
      out.push({
        check: "trailers",
        path: c.sha,
        message: "carries both Knowledge-Record and Knowledge-None — say one or the other; nothing was assumed",
      });
    if (t.none.length) noneBy.add(c.sha);
    for (const id of t.records) trailerRecords.add(id);
    const code = c.files.filter((f) => !f.startsWith(`${STORE_DIR}/`));
    if (t.none.length && code.length === 0) noneAnywhere.push(c.sha);
    for (const f of code) {
      const m = moduleOf(modules, f);
      if (!m) continue;
      const set = touches.get(m) ?? new Set();
      set.add(c.sha);
      touches.set(m, set);
    }
  }

  const coveringRecords = new Set<string>();
  for (const f of change.files) {
    const id = idFromRecordPath(f.path, "records");
    if (id && (f.status === "A" || f.status === "R")) coveringRecords.add(id);
  }
  for (const id of trailerRecords) coveringRecords.add(id);

  for (const [m, shas] of [...touches].sort(([a], [b]) => cmp(a, b))) {
    if ([...shas].some((s) => noneBy.has(s)) || noneAnywhere.length) continue;
    const covered = [...coveringRecords].some((id) => {
      const k = trust.records.get(id); // records only: a draft or a rejected draft covers nothing
      return k !== undefined && recordModules(modules, k.front).has(m);
    });
    if (covered) continue;
    const drafts = [...trust.drafts].filter(([, k]) => recordModules(modules, k.front).has(m)).map(([id]) => id);
    const list = [...shas].map((s) => s.slice(0, 7)).join(", ");
    out.push({
      check: "unrecorded",
      path: m,
      message:
        `changed in ${list} with no accepted record and no Knowledge-None: statement (FR-015)` +
        (drafts.length
          ? ` — draft ${drafts.join(", ")} would cover it once a person accepts it (FR-045)`
          : ` — capture what was decided (enou record, then enou accept), or add "Knowledge-None: <reason>" to a commit message`),
    });
  }
  return out;
}
