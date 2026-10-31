// Repository root discovery (contracts/cli.md, "Repository root"; tasks.md T004b).
//
// `ENOU_ROOT` if set; otherwise the nearest ancestor of the current directory that contains
// `.knowledge/`; otherwise the git top level. Running a command from a subdirectory therefore
// behaves exactly like running it from the root.

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { git } from "../knowledge/platform";
import { STORE_DIR } from "../knowledge/store";

export type RootResult = { ok: true; root: string } | { ok: false; message: string };

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function findRoot(cwd: string, env: Record<string, string | undefined> = process.env): RootResult {
  const fromEnv = env.ENOU_ROOT?.trim();
  if (fromEnv) {
    const root = resolve(cwd, fromEnv);
    return isDir(root) ? { ok: true, root: realpathSync(root) } : { ok: false, message: `ENOU_ROOT=${fromEnv} is not a directory` };
  }
  let dir = resolve(cwd);
  for (;;) {
    if (isDir(resolve(dir, STORE_DIR))) return { ok: true, root: realpathSync(dir) };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (top.code === 0 && top.stdout.trim()) return { ok: true, root: realpathSync(top.stdout.trim()) };
  return { ok: false, message: `no ${STORE_DIR}/ directory and no git repository at or above ${cwd}` };
}

/**
 * A path argument as the user typed it — relative to the current directory — expressed relative
 * to the repository root with `/` separators. Symbolic links are resolved on both sides when the
 * path exists, so a symlinked checkout does not make every file look outside the repository.
 */
export function toRepoPath(root: string, cwd: string, arg: string): { ok: true; path: string } | { ok: false; message: string } {
  const abs = realOrNearest(isAbsolute(arg) ? arg : resolve(cwd, arg));
  const rel = relative(root, abs);
  if (rel === "") return { ok: true, path: "." };
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return { ok: false, message: `${arg} is outside the repository (${root})` };
  return { ok: true, path: rel.split(sep).join("/") };
}

/** The real path of `p`, or — when `p` does not exist, as for a deleted file — the real path of its
 *  nearest existing ancestor with the rest appended. */
function realOrNearest(p: string): string {
  let head = p;
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return p;
    tail.unshift(head.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    head = parent;
  }
  return resolve(realpathSync(head), ...tail);
}
