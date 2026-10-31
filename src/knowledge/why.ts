// "Why is this like this?" — the deterministic answer (FR-008–FR-010, FR-037, FR-038, FR-047).
//
// Assembled, never synthesised: records whose paths (or declared symbols) relate to the question,
// records reachable through git's rename history and through a module's `formerly` aliases, and
// records named by `Knowledge-Record:` trailers on commits touching the path. Every id goes through
// the trust predicate, so drafts and rejected drafts contribute nothing unless drafts are asked for,
// and then they are labelled. Ordering follows the `supersedes` graph — a record that supersedes
// another is newer by definition — and the id only breaks ties between unrelated records, because
// ids from machines with skewed clocks need not sort by creation (data-model §2.2).
//
// A record that cannot be read is reported with the answer, never silently omitted: an answer that
// looks complete while missing a record is the confident-wrong-answer failure (Principle II).

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { staticPrefix } from "./capture";
import { patternCovers, resolveModule, type ModulesConfig } from "./modules";
import { git, globMatch } from "./platform";
import { parseSymbol, type FrontMatter, type Issue } from "./record";
import { STORE_DIR, type StoreSnapshot } from "./store";
import { declaredFiles, findDefinitions, type Definition } from "./symbols";
import { buildTrust, statusOf, type Known, type TrustView } from "./trust";

const GLOB_CHARS = /[*?[\]{}]/;

/** Whether a record's path (or glob, or directory) concerns the queried path, in either direction. */
export function relates(recordPath: string, query: string): boolean {
  const rp = recordPath.endsWith("/") ? recordPath.slice(0, -1) : recordPath;
  const q = query === "." ? "" : query.endsWith("/") ? query.slice(0, -1) : query;
  if (q === "") return true;
  if (rp === q || q.startsWith(rp + "/") || rp.startsWith(q + "/")) return true;
  if (!GLOB_CHARS.test(rp)) return false;
  if (globMatch(rp, q) || globMatch(`${rp}/**`, q)) return true;
  // A directory question about a glob's territory: the glob's literal prefix is inside the directory
  // or is the directory, or the directory is inside it and `**` reaches down into it.
  const sp = staticPrefix(rp);
  return sp === "" || sp === q || sp.startsWith(q + "/") || (q.startsWith(sp + "/") && rp.includes("**"));
}

/** The commit that first added the record's file under either directory (data-model §2.7). */
export function implementingCommit(root: string, id: string): string | null {
  const r = git(
    ["log", "--diff-filter=A", "--format=%H", "--", `${STORE_DIR}/records/${id}.md`, `${STORE_DIR}/inbox/${id}.md`],
    root,
  );
  if (r.code !== 0) return null;
  const lines = r.stdout.split("\n").filter(Boolean);
  return lines.length ? lines[lines.length - 1]! : null;
}

/**
 * The implementing commit of every record and draft, from ONE `git log` over the store, instead of
 * one git process per record — the per-record call was what made a brief over many paths slow
 * (research.md §11, T055h). Same rule as implementingCommit: the oldest commit that added the file
 * under either directory.
 */
export function implementingCommits(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const r = git(
    ["log", "--diff-filter=A", "--format=%x00%H", "--name-only", "--", `${STORE_DIR}/records/`, `${STORE_DIR}/inbox/`],
    root,
  );
  if (r.code !== 0) return out;
  // Newest first, so the last commit seen for an id is its oldest.
  for (const chunk of r.stdout.split("\0")) {
    const [sha, ...files] = chunk.split("\n").filter(Boolean);
    if (!sha) continue;
    for (const f of files) {
      const m = /\/([0-9A-HJKMNP-TV-Z]{26})\.md$/.exec(f);
      if (m) out.set(m[1]!, sha);
    }
  }
  return out;
}

/** Every name the file has had, following git's rename detection (FR-038). */
export function renameHistory(root: string, path: string): string[] {
  const r = git(["log", "--follow", "--name-only", "--format=", "--", path], root);
  if (r.code !== 0) return [];
  return [...new Set(r.stdout.split("\n").filter(Boolean))].filter((p) => p !== path);
}

/** Record ids named by `Knowledge-Record:` trailers on commits touching `paths`, with the commits. */
export function trailerIds(root: string, paths: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const r = git(
    ["log", "--format=%H%x1f%(trailers:key=Knowledge-Record,valueonly,separator=%x2C)%x1e", "--", ...paths],
    root,
  );
  if (r.code !== 0) return out;
  for (const chunk of r.stdout.split("\x1e")) {
    const [sha, value] = chunk.trim().split("\x1f");
    if (!sha || !value) continue;
    for (const id of value.split(/[,\s]+/).filter(Boolean)) {
      const list = out.get(id) ?? [];
      list.push(sha);
      out.set(id, list);
    }
  }
  return out;
}

export interface WhyRecord {
  id: string;
  front: FrontMatter;
  body: string;
  path: string;
  status: "current" | "superseded" | "draft";
  supersededBy: string[];
  implementingCommit: string | null;
  matchedBy: string[];
}

export interface WhyAnswer {
  query: string;
  kind: "path" | "symbol";
  /** For a symbol: the file it resolved to, if exactly one. */
  resolvedPath?: string;
  /** Every path the answer considered: the path itself, former names, `formerly` aliases. */
  names: string[];
  records: WhyRecord[];
  drafts: WhyRecord[];
  /** Drafts about this path that are waiting for acceptance, counted even when not shown. */
  draftsWaiting: number;
  /** Records in the store that could not be read — the answer may be missing them. */
  unreadable: { path: string; issues: Issue[] }[];
  /** For an ambiguous symbol: every candidate, and no records. */
  candidates?: { path: string; line?: number; declaredBy?: string[] }[];
  note?: string;
}

export interface WhyOptions {
  includeDrafts?: boolean;
  /** A trust view already built for this snapshot — a brief builds it once, not once per path. */
  trust?: TrustView;
  /** Implementing commits already looked up (implementingCommits) — one git call per command. */
  commits?: Map<string, string>;
  /** Skip git (rename history, trailers, implementing commits) — for tests and degraded setups. */
  noGit?: boolean;
}

function formerlyAliases(modules: ModulesConfig, path: string): string[] {
  const m = resolveModule(modules, path);
  if (!m || m.via !== "path") return [];
  const rest = path === m.module.path ? "" : path.slice(m.module.path.length);
  return m.module.formerly.filter((f) => !GLOB_CHARS.test(f)).map((f) => f + rest);
}

function matchReasons(r: Known, names: readonly string[], trailers: Map<string, string[]>, id: string): string[] {
  const reasons: string[] = [];
  const anchors = [...r.front.paths, ...(r.front.symbols ?? []).map((s) => {
    const p = parseSymbol(s);
    return typeof p === "string" ? "" : p.path;
  })].filter(Boolean);
  for (const n of names)
    for (const rp of anchors)
      if (relates(rp, n)) {
        reasons.push(`${rp === n ? "path" : "covers"} ${rp}${rp === n ? "" : ` (asked: ${n})`}`);
        break;
      }
  const commits = trailers.get(id);
  if (commits) reasons.push(`Knowledge-Record trailer on ${commits.map((c) => c.slice(0, 7)).join(", ")}`);
  return [...new Set(reasons)];
}

/** Oldest → newest along the `supersedes` graph; the id breaks ties between unrelated records. */
export function orderBySupersession<T extends { id: string; front: { supersedes?: string } }>(items: T[]): T[] {
  const byId = new Map(items.map((x) => [x.id, x]));
  const indegree = new Map(items.map((x) => [x.id, 0]));
  const next = new Map<string, string[]>();
  for (const x of items) {
    const t = x.front.supersedes;
    if (t && byId.has(t) && t !== x.id) {
      indegree.set(x.id, indegree.get(x.id)! + 1);
      next.set(t, [...(next.get(t) ?? []), x.id]);
    }
  }
  const ready = items.filter((x) => indegree.get(x.id) === 0).map((x) => x.id).sort();
  const out: T[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const n of next.get(id) ?? []) {
      indegree.set(n, indegree.get(n)! - 1);
      if (indegree.get(n) === 0) {
        ready.push(n);
        ready.sort();
      }
    }
  }
  // A cycle (only possible by hand-editing) leaves nodes behind: append them by id, never drop them.
  if (out.length < items.length)
    out.push(...items.filter((x) => !out.includes(x)).sort((a, b) => (a.id < b.id ? -1 : 1)));
  return out;
}

function toWhy(_root: string, id: string, k: Known, trust: TrustView, reasons: string[], opts: WhyOptions): WhyRecord {
  const s = statusOf(trust, id);
  return {
    id,
    front: k.front,
    body: k.body,
    path: k.path,
    status: s.status === "superseded" ? "superseded" : s.status === "draft" ? "draft" : "current",
    supersededBy: s.status === "superseded" ? s.by : [],
    implementingCommit: opts.noGit ? null : (opts.commits?.get(id) ?? null),
    matchedBy: reasons,
  };
}

/** The answer for a repository-relative path. */
export function whyPath(
  root: string,
  snapshot: StoreSnapshot,
  modules: ModulesConfig,
  path: string,
  opts: WhyOptions = {},
): WhyAnswer {
  const trust = opts.trust ?? buildTrust(snapshot);
  opts = { ...opts, trust, commits: opts.noGit ? undefined : (opts.commits ?? implementingCommits(root)) };
  const former = opts.noGit || !isFileLike(root, path) ? [] : renameHistory(root, path);
  const names = [...new Set([path, ...former, ...formerlyAliases(modules, path)])];
  const trailers = opts.noGit ? new Map<string, string[]>() : trailerIds(root, names);

  const collect = (pool: Map<string, Known>) => {
    const hits: WhyRecord[] = [];
    for (const [id, k] of pool) {
      const reasons = matchReasons(k, names, trailers, id);
      if (reasons.length) hits.push(toWhy(root, id, k, trust, reasons, opts));
    }
    return orderBySupersession(hits);
  };
  const drafts = collect(trust.drafts);
  return {
    query: path,
    kind: "path",
    names,
    records: collect(trust.records),
    drafts: opts.includeDrafts ? drafts : [],
    draftsWaiting: drafts.length,
    unreadable: trust.invalid,
  };
}

/** A file, or a path that no longer exists (a deleted file) — what git's rename history can follow. */
function isFileLike(root: string, path: string): boolean {
  if (path === "." || path.endsWith("/")) return false;
  return !existsSync(join(root, path)) || !statSync(join(root, path)).isDirectory();
}

/** The answer for a symbol: resolve it to exactly one file, or list the candidates and answer none. */
export function whySymbol(
  root: string,
  snapshot: StoreSnapshot,
  modules: ModulesConfig,
  name: string,
  opts: WhyOptions & { path?: string } = {},
): WhyAnswer {
  const trust = buildTrust(snapshot);
  const base = {
    query: opts.path ? `${opts.path}#${name}` : name,
    kind: "symbol" as const,
    records: [],
    drafts: [],
    draftsWaiting: 0,
    unreadable: trust.invalid,
  };

  if (opts.path) {
    const a = whyPath(root, snapshot, modules, opts.path, opts);
    return { ...a, query: base.query, kind: "symbol", resolvedPath: opts.path, note: `named explicitly as ${opts.path}#${name}` };
  }

  const declared = declaredFiles(trust, name);
  if (declared.size === 1) {
    const [[file, ids]] = [...declared];
    const a = whyPath(root, snapshot, modules, file!, opts);
    return { ...a, query: name, kind: "symbol", resolvedPath: file, note: `declared in ${file} by ${ids!.join(", ")}` };
  }
  if (declared.size > 1)
    return {
      ...base,
      names: [],
      candidates: [...declared].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, ids]) => ({ path, declaredBy: ids })),
      note: `${name} is declared in ${declared.size} files; ask with <path>#${name} to choose one`,
    };

  const search = opts.noGit ? ({ ok: true, definitions: [] } as const) : findDefinitions(root, name);
  if (!search.ok) return { ...base, names: [], note: `could not search for a definition: ${search.reason}` };
  const files = [...new Map(search.definitions.map((d: Definition) => [d.path, d])).values()];
  if (files.length === 1) {
    const a = whyPath(root, snapshot, modules, files[0]!.path, opts);
    return { ...a, query: name, kind: "symbol", resolvedPath: files[0]!.path, note: `defined at ${files[0]!.path}:${files[0]!.line}` };
  }
  if (files.length > 1)
    return {
      ...base,
      names: [],
      candidates: search.definitions.map((d: Definition) => ({ path: d.path, line: d.line })),
      note: `${name} is defined in ${files.length} files; ask with <path>#${name} to choose one`,
    };
  return { ...base, names: [], note: `no definition of ${name} was found in the tracked files` };
}

/**
 * Whether an argument names a path rather than a symbol (contracts/cli.md, "Path or symbol"):
 * it exists now, a record or a module's `formerly` mentions it, or git has ever tracked it — so a
 * deleted or renamed file still answers from its records.
 */
export function isPathQuestion(root: string, trust: TrustView, modules: ModulesConfig, path: string, noGit = false): boolean {
  if (path === "." || existsSync(join(root, path))) return true;
  for (const k of trust.records.values()) if (k.front.paths.some((p) => relates(p, path) && staticPrefix(p) !== "")) return true;
  if (modules.modules.some((m) => m.formerly.some((f) => patternCovers(f, path)))) return true;
  if (noGit) return false;
  const r = git(["log", "--all", "-1", "--format=%H", "--", path], root);
  return r.code === 0 && r.stdout.trim() !== "";
}
