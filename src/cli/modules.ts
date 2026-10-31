// `enou modules list | uncovered | add | move | remove` (FR-024, FR-026, FR-037, FR-039).
//
// The file stays hand-editable: add/move/remove rewrite it in one fixed layout but keep the comment
// lines at its top. A move keeps the old path as `formerly`, so knowledge stays attached (FR-037);
// a removal reports how many records it un-covers (FR-039) — and so does `lint`, because the file is
// often edited by hand.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRepoPath } from "../knowledge/record";
import { MODULES_FILE, parseModules, resolveModule, type ModuleDecl, type ModulesConfig } from "../knowledge/modules";
import { git } from "../knowledge/platform";
import { loadStore } from "../knowledge/store";
import { buildTrust } from "../knowledge/trust";
import { staticPrefix } from "../knowledge/capture";
import type { Args } from "./commands";
import { EXIT, json, list, modulesOrRefuse, repoPath, type Ctx } from "./util";

/** Records whose paths resolve to `module` under `config`. */
export function recordsIn(ctx: Ctx, config: ModulesConfig, module: string): string[] {
  const trust = buildTrust(loadStore(ctx.root));
  const ids: string[] = [];
  for (const [id, r] of trust.records)
    if (r.front.paths.some((p) => resolveModule(config, staticPrefix(p) || p)?.module.path === module)) ids.push(id);
  return ids;
}

/** Tracked files no module covers, collapsed to the highest directory that is wholly uncovered. */
export function uncovered(root: string, config: ModulesConfig): string[] | string {
  const r = git(["ls-files", "-z"], root);
  if (r.code !== 0) return `cannot list tracked files: ${r.stderr.trim() || "not a git repository"}`;
  // The knowledge store is not code: it is never "uncovered".
  const files = r.stdout.split("\0").filter((f) => f && !f.startsWith(".knowledge/"));
  const covered = new Set(files.filter((f) => resolveModule(config, f)));
  const dirHasCovered = new Set<string>();
  for (const f of covered) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) dirHasCovered.add(parts.slice(0, i).join("/"));
  }
  const out = new Set<string>();
  for (const f of files) {
    if (covered.has(f)) continue;
    const parts = f.split("/");
    let shown = f;
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!dirHasCovered.has(dir)) {
        shown = `${dir}/`;
        break;
      }
    }
    out.add(shown);
  }
  return [...out].sort();
}

function emit(header: string, config: ModulesConfig): string {
  const lim = (v: Record<string, number>) => `{ ${Object.entries(v).map(([k, n]) => `${k}: ${n}`).join(", ")} }`;
  const lines = [header.trimEnd(), "defaults:", `  view: ${lim({ ...config.defaults })}`, "modules:"].filter((l, i) => i > 0 || l);
  if (!config.modules.length) lines[lines.length - 1] = "modules: []";
  for (const m of config.modules) {
    lines.push(`  - path: ${JSON.stringify(m.path)}`);
    if (m.formerly.length) lines.push(`    formerly: [${m.formerly.map((f) => JSON.stringify(f)).join(", ")}]`);
    const over = Object.fromEntries(
      Object.entries(m.view).filter(([k, v]) => v !== config.defaults[k as keyof typeof config.defaults]),
    );
    if (Object.keys(over).length) lines.push(`    view: ${lim(over)}`);
  }
  return lines.join("\n") + "\n";
}

function headerOf(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    if (l.startsWith("#") || (l.trim() === "" && out.length)) out.push(l);
    else break;
  }
  return out.join("\n");
}

function save(ctx: Ctx, config: ModulesConfig): void {
  const file = join(ctx.root, MODULES_FILE);
  const header = existsSync(file)
    ? headerOf(readFileSync(file, "utf8"))
    : "# Module declarations (FR-024): a path belongs to a module only by appearing here.\n# `formerly` keeps knowledge attached across a rename (FR-037).";
  const text = emit(header, config);
  const check = parseModules(text);
  if (!check.ok) throw new Error(`refusing to write a modules.yaml that does not parse back: ${JSON.stringify(check.issues)}`);
  mkdirSync(join(ctx.root, ".knowledge"), { recursive: true }); // first declaration in a fresh repo
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
}

export function runModules(args: Args, ctx: Ctx): number {
  const config = modulesOrRefuse(ctx, "modules");
  if (typeof config === "number") return config;
  const action = String(args.action);
  const rest = list(args.args);
  const fail = (m: string) => {
    ctx.io.err(`enou modules ${action}: ${m}`);
    return EXIT.refused;
  };
  const pathArg = (a: string | undefined) => {
    if (a === undefined) return { ok: false as const, message: "needs a path" };
    const r = repoPath(ctx, a);
    if (!r.ok) return r;
    const p = r.path.endsWith("/") ? r.path.slice(0, -1) : r.path;
    const err = checkRepoPath(p);
    return err ? { ok: false as const, message: `${p} ${err}` } : { ok: true as const, path: p };
  };

  if (action === "list") {
    const rows = config.modules.map((m) => ({ path: m.path, formerly: m.formerly, view: m.view, records: recordsIn(ctx, config, m.path).length }));
    if (args.json) json(ctx, { defaults: config.defaults, modules: rows });
    else if (!rows.length) ctx.io.out("no modules declared — every path is uncovered. Add one: enou modules add <path>");
    else
      for (const r of rows)
        ctx.io.out(`${r.path}  ${r.records} record${r.records === 1 ? "" : "s"}${r.formerly.length ? `  formerly ${r.formerly.join(", ")}` : ""}`);
    return EXIT.ok;
  }

  if (action === "uncovered") {
    const u = uncovered(ctx.root, config);
    if (typeof u === "string") return fail(u);
    if (args.json) json(ctx, { uncovered: u });
    else if (!u.length) ctx.io.out("every tracked path belongs to a declared module");
    else for (const p of u) ctx.io.out(p);
    return EXIT.ok;
  }

  if (action === "add") {
    if (rest.length !== 1) return fail("usage: enou modules add <path>");
    const p = pathArg(rest[0]);
    if (!p.ok) return fail(p.message);
    if (config.modules.some((m) => m.path === p.path)) return fail(`${p.path} is already declared`);
    config.modules.push({ path: p.path, formerly: [], view: { ...config.defaults }, index: config.modules.length });
    save(ctx, config);
    ctx.io.out(`declared ${p.path} in ${MODULES_FILE}`);
    return EXIT.ok;
  }

  if (action === "move") {
    if (rest.length !== 2) return fail("usage: enou modules move <from> <to>");
    const from = pathArg(rest[0]);
    const to = pathArg(rest[1]);
    if (!from.ok) return fail(from.message);
    if (!to.ok) return fail(to.message);
    const m = config.modules.find((x) => x.path === from.path);
    if (!m) return fail(`${from.path} is not declared`);
    if (config.modules.some((x) => x.path === to.path)) return fail(`${to.path} is already declared`);
    m.formerly = [...new Set([...m.formerly, m.path])];
    m.path = to.path;
    save(ctx, config);
    ctx.io.out(`moved ${from.path} → ${to.path}; ${from.path} is kept as formerly, so its records stay attached (FR-037)`);
    return EXIT.ok;
  }

  // remove
  if (rest.length !== 1) return fail("usage: enou modules remove <path>");
  const p = pathArg(rest[0]);
  if (!p.ok) return fail(p.message);
  const m = config.modules.find((x) => x.path === p.path);
  if (!m) return fail(`${p.path} is not declared`);
  const before = recordsIn(ctx, config, m.path);
  const next: ModulesConfig = { defaults: config.defaults, modules: config.modules.filter((x) => x !== m) as ModuleDecl[] };
  const trust = buildTrust(loadStore(ctx.root));
  const uncoveredIds = before.filter((id) =>
    trust.records.get(id)!.front.paths.every((rp) => !resolveModule(next, staticPrefix(rp) || rp)),
  );
  save(ctx, next);
  ctx.io.out(
    `removed ${p.path}. ${uncoveredIds.length} of its ${before.length} record${before.length === 1 ? "" : "s"} now belong to no module ` +
      `(FR-039) — they still answer \`enou why\`, but appear in no view.`,
  );
  return EXIT.ok;
}
