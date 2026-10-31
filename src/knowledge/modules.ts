// Module declarations — `.knowledge/modules.yaml`, the single list (FR-024, data-model §2.4).
//
// A path belongs to a module only by appearing here. `formerly` keeps knowledge attached across a
// rename (FR-037). Per-module `view` limits fall back to `defaults.view`, which fall back to the
// published defaults below. Resolution is total and order-independent of the filesystem (FR-032):
//   1. a module's current `path` beats any module's `formerly`;
//   2. among the same kind of match, the more specific pattern wins (longer literal prefix);
//   3. remaining ties break by declaration order in the file.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRepoPath, type Issue } from "./record";
import { globMatch, parseYaml } from "./platform";
import { STORE_DIR } from "./store";

export interface ViewLimits {
  /** N: the most records a current-truth view shows (FR-013). */
  max_records: number;
  /** The longest one-line summary, in characters (FR-013, FR-031). */
  max_summary: number;
  /** The most file-specific records the read hook adds after a view (contracts/hooks.md §3). */
  max_file_records: number;
}

export const PUBLISHED_DEFAULTS: Readonly<ViewLimits> = { max_records: 20, max_summary: 120, max_file_records: 3 };
const LIMIT_KEYS = Object.keys(PUBLISHED_DEFAULTS) as (keyof ViewLimits)[];

export interface ModuleDecl {
  path: string;
  formerly: string[];
  view: ViewLimits;
  /** Position in the file — the last tie-break. */
  index: number;
}

export interface ModulesConfig {
  defaults: ViewLimits;
  modules: ModuleDecl[];
}

export type ModulesResult = { ok: true; config: ModulesConfig } | { ok: false; issues: Issue[] };

export const MODULES_FILE = `${STORE_DIR}/modules.yaml`;

/** No file means nothing is declared — every path is uncovered, which is a valid state. */
export function loadModules(root: string): ModulesResult {
  const file = join(root, MODULES_FILE);
  if (!existsSync(file)) return { ok: true, config: { defaults: { ...PUBLISHED_DEFAULTS }, modules: [] } };
  return parseModules(readFileSync(file, "utf8"));
}

function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function limits(raw: unknown, field: string, base: ViewLimits, issues: Issue[]): ViewLimits {
  const out = { ...base };
  if (raw === undefined) return out;
  if (!isMap(raw)) {
    issues.push({ field, message: "must be a mapping of view limits" });
    return out;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!LIMIT_KEYS.includes(k as keyof ViewLimits))
      issues.push({ field: `${field}.${k}`, message: `is not a view limit; expected one of ${LIMIT_KEYS.join(", ")}` });
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      issues.push({ field: `${field}.${k}`, message: "must be a whole number of at least 1" });
    else out[k as keyof ViewLimits] = v;
  }
  return out;
}

function pattern(raw: unknown, field: string, issues: Issue[]): string | null {
  const err = checkRepoPath(raw);
  if (err) {
    issues.push({ field, message: err });
    return null;
  }
  const p = raw as string;
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

export function parseModules(text: string): ModulesResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return { ok: false, issues: [{ field: "(file)", message: `is not valid YAML: ${(e as Error).message}` }] };
  }
  if (doc === null || doc === undefined) doc = {};
  if (!isMap(doc)) return { ok: false, issues: [{ field: "(file)", message: "must be a mapping" }] };
  const issues: Issue[] = [];
  for (const k of Object.keys(doc))
    if (k !== "modules" && k !== "defaults") issues.push({ field: k, message: "is not a known key (modules, defaults)" });

  let defaults = { ...PUBLISHED_DEFAULTS };
  if (doc.defaults !== undefined) {
    if (!isMap(doc.defaults)) issues.push({ field: "defaults", message: "must be a mapping" });
    else {
      for (const k of Object.keys(doc.defaults))
        if (k !== "view") issues.push({ field: `defaults.${k}`, message: "is not a known key (view)" });
      defaults = limits(doc.defaults.view, "defaults.view", defaults, issues);
    }
  }

  const modules: ModuleDecl[] = [];
  const raw = doc.modules ?? [];
  if (!Array.isArray(raw)) issues.push({ field: "modules", message: "must be a list" });
  else
    raw.forEach((m, i) => {
      const f = `modules[${i}]`;
      if (!isMap(m)) return void issues.push({ field: f, message: "must be a mapping with a path" });
      for (const k of Object.keys(m))
        if (!["path", "formerly", "view"].includes(k))
          issues.push({ field: `${f}.${k}`, message: "is not a known key (path, formerly, view)" });
      const path = m.path === undefined ? (issues.push({ field: `${f}.path`, message: "is required" }), null) : pattern(m.path, `${f}.path`, issues);
      const formerly: string[] = [];
      if (m.formerly !== undefined) {
        if (!Array.isArray(m.formerly)) issues.push({ field: `${f}.formerly`, message: "must be a list of paths" });
        else
          m.formerly.forEach((g, j) => {
            const p = pattern(g, `${f}.formerly[${j}]`, issues);
            if (p) formerly.push(p);
          });
      }
      const view = limits(m.view, `${f}.view`, defaults, issues);
      if (path) {
        const dup = modules.find((x) => x.path === path);
        if (dup) issues.push({ field: `${f}.path`, message: `${path} is already declared by modules[${dup.index}]` });
        modules.push({ path, formerly, view, index: i });
      }
    });

  return issues.length ? { ok: false, issues } : { ok: true, config: { defaults, modules } };
}

const GLOB_CHARS = /[*?[\]{}]/;

function literalPrefixLength(p: string): number {
  const at = p.search(GLOB_CHARS);
  return at < 0 ? p.length : at;
}

/** Whether a declaration pattern covers `path`: the path itself, anything beneath it, or a glob. */
export function patternCovers(pat: string, path: string): boolean {
  const p = path.endsWith("/") ? path.slice(0, -1) : path;
  if (p === pat || p.startsWith(pat + "/")) return true;
  return GLOB_CHARS.test(pat) && (globMatch(pat, p) || globMatch(`${pat}/**`, p));
}

export interface Resolution {
  module: ModuleDecl;
  via: "path" | "formerly";
  pattern: string;
}

/** The module a repository-relative path belongs to, or null when it is uncovered (FR-025). */
export function resolveModule(config: ModulesConfig, path: string): Resolution | null {
  for (const via of ["path", "formerly"] as const) {
    let best: Resolution | null = null;
    for (const m of config.modules) {
      for (const pat of via === "path" ? [m.path] : m.formerly) {
        if (!patternCovers(pat, path)) continue;
        const cand: Resolution = { module: m, via, pattern: pat };
        if (!best || beats(cand, best)) best = cand;
      }
    }
    if (best) return best;
  }
  return null;
}

function beats(a: Resolution, b: Resolution): boolean {
  const la = literalPrefixLength(a.pattern);
  const lb = literalPrefixLength(b.pattern);
  return la !== lb ? la > lb : a.module.index < b.module.index;
}
