// Symbol → defining file (FR-047, research.md §15).
//
// Declared symbols first; otherwise a literal definition search with `git grep` over the tracked
// files. No index, so nothing can be stale, and it works at any revision. The one-file rule applies
// to both: exactly one file answers; several are listed and none is chosen; none is said plainly.
// A definition the patterns cannot see (a member nested in another definition) is a missing answer,
// never a wrong one — which is why every pattern is anchored at column 0.
//
// v1 covers TypeScript and JavaScript.

import { git } from "./platform";
import { parseSymbol } from "./record";
import type { TrustView } from "./trust";

export interface Definition {
  path: string;
  line: number;
}

export const SOURCE_PATHSPECS = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

/** POSIX ERE patterns (no `\b`, no `\s`, so BSD and GNU git agree) for a top-level definition. */
export function definitionPatterns(name: string): string[] {
  const n = name.replace(/\$/g, "\\$");
  const S = "[[:space:]]";
  const END = "([^[:alnum:]_$]|$)";
  const EXPORT = `(export${S}+)?(default${S}+)?(declare${S}+)?`;
  return [
    `^${EXPORT}(async${S}+)?function${S}*\\*?${S}*${n}${END}`,
    `^${EXPORT}(abstract${S}+)?class${S}+${n}${END}`,
    `^${EXPORT}(const|let|var)${S}+${n}${END}`,
    `^${EXPORT}(interface|type|namespace|module)${S}+${n}${END}`,
    `^${EXPORT}(const${S}+)?enum${S}+${n}${END}`,
  ];
}

export type SearchResult = { ok: true; definitions: Definition[] } | { ok: false; reason: string };

/** Literal definition search over tracked files — the working tree's, or those at `rev`. */
export function findDefinitions(root: string, name: string, rev?: string): SearchResult {
  const args = ["grep", "-n", "-I", "-E", "--no-color", ...definitionPatterns(name).flatMap((p) => ["-e", p])];
  if (rev) args.push(rev);
  args.push("--", ...SOURCE_PATHSPECS);
  const r = git(args, root);
  if (r.code === 1) return { ok: true, definitions: [] }; // git grep: no match
  if (r.code !== 0) return { ok: false, reason: r.stderr.trim() || `git grep exited ${r.code}` };
  const definitions: Definition[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    // `path:line:text`, or `rev:path:line:text` when a revision was given
    const parts = line.split(":");
    const [path, lineNo] = rev ? [parts[1]!, parts[2]!] : [parts[0]!, parts[1]!];
    definitions.push({ path, line: Number(lineNo) });
  }
  definitions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  return { ok: true, definitions };
}

/** Files that records declare `name` in, with the declaring record ids. */
export function declaredFiles(trust: TrustView, name: string, path?: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const [id, r] of trust.records)
    for (const s of r.front.symbols ?? []) {
      const parsed = parseSymbol(s);
      if (typeof parsed === "string" || parsed.name !== name || (path && parsed.path !== path)) continue;
      const ids = files.get(parsed.path) ?? [];
      ids.push(id);
      files.set(parsed.path, ids);
    }
  return files;
}

/** Whether `path` still defines `name` (FR-016 for declared symbols). */
export function stillDefines(root: string, path: string, name: string, rev?: string): boolean | null {
  const args = ["grep", "-q", "-I", "-E", ...definitionPatterns(name).flatMap((p) => ["-e", p])];
  if (rev) args.push(rev);
  args.push("--", path);
  const r = git(args, root);
  return r.code === 0 ? true : r.code === 1 ? false : null;
}
