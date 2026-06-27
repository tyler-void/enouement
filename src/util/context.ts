// Context Packs (CCI) — living domain docs stored IN the repo, mirroring the source tree:
//   src/modules/payment/.context/domain_logic.md
// The agent reads them (cheap domain knowledge) instead of re-reading the codebase, and writes
// them back after finishing work (reviewed in the PR). The LLM synthesis is done by the agent's
// own model; these helpers just serve and persist the markdown.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";

const CONTEXT_DIR = ".context";

export interface Pack {
  path: string; // relative to workspace
  content: string;
}

/** Walk up from `startPath` to `root`, collecting every `.context/*.md` along the way (layered:
 *  module-specific first, broader context last). */
export function findContextPacks(root: string, startPath: string): Pack[] {
  const packs: Pack[] = [];
  let dir = resolve(root, startPath);
  if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  const rootAbs = resolve(root);
  while (dir.startsWith(rootAbs)) {
    const cdir = join(dir, CONTEXT_DIR);
    if (existsSync(cdir) && statSync(cdir).isDirectory()) {
      for (const f of readdirSync(cdir)) {
        if (f.endsWith(".md")) {
          packs.push({ path: relative(rootAbs, join(cdir, f)), content: readFileSync(join(cdir, f), "utf8") });
        }
      }
    }
    if (dir === rootAbs) break;
    dir = dirname(dir);
  }
  return packs;
}

/** Append (default) or replace a Context Pack at `<module>/.context/<file>`. */
export function writeContextPack(
  root: string,
  modulePath: string,
  content: string,
  opts: { file?: string; mode?: "append" | "replace" } = {},
): string {
  const file = opts.file ?? "domain_logic.md";
  const cdir = join(resolve(root, modulePath), CONTEXT_DIR);
  mkdirSync(cdir, { recursive: true });
  const dest = join(cdir, file);
  if (opts.mode === "replace" || !existsSync(dest)) {
    writeFileSync(dest, content.trim() + "\n", "utf8");
  } else {
    const prev = readFileSync(dest, "utf8").trimEnd();
    writeFileSync(dest, `${prev}\n\n---\n\n${content.trim()}\n`, "utf8");
  }
  return relative(resolve(root), dest);
}
