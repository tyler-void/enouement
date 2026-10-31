// `enou view` · `enou log` (FR-012–FR-014, FR-027*, FR-040), and — US3, still placeholders —
// `enou brief` (FR-048) and `enou show`.

import { loadStore } from "../knowledge/store";
import { buildTrust } from "../knowledge/trust";
import { findModule, moduleView, renderLog, renderView } from "../knowledge/view";
import type { Args } from "./commands";
import { EXIT, json, modulesOrRefuse, repoPath, type Ctx } from "./util";

function resolveModuleArg(ctx: Ctx, what: string, arg: string) {
  const modules = modulesOrRefuse(ctx, what);
  if (typeof modules === "number") return modules;
  const r = repoPath(ctx, arg);
  const m = r.ok ? findModule(modules, r.path) : undefined;
  if (!m) {
    ctx.io.err(
      `enou ${what}: ${arg} is not a declared module. Declared: ${modules.modules.map((x) => x.path).join(", ") || "none — enou modules add <path>"}`,
    );
    return EXIT.refused;
  }
  return { modules, module: m };
}

export function runView(args: Args, ctx: Ctx): number {
  const r = resolveModuleArg(ctx, "view", String(args.module));
  if (typeof r === "number") return r;
  const trust = buildTrust(loadStore(ctx.root));
  const v = moduleView(trust, r.modules, r.module);
  if (args.json)
    json(ctx, {
      module: v.module,
      limits: r.module.view,
      shown: v.shown,
      omitted: v.omitted,
      total: v.total,
      drafts: args.include_drafts ? v.drafts : [],
      text: renderView(v, { includeDrafts: Boolean(args.include_drafts) }),
    });
  else ctx.io.out(renderView(v, { includeDrafts: Boolean(args.include_drafts) }) || `${v.module} — no recorded knowledge`);
  return EXIT.ok;
}

export function runLog(args: Args, ctx: Ctx): number {
  const r = resolveModuleArg(ctx, "log", String(args.module));
  if (typeof r === "number") return r;
  const trust = buildTrust(loadStore(ctx.root));
  const text = renderLog(trust, r.modules, r.module, { includeDrafts: Boolean(args.include_drafts) });
  if (args.json) json(ctx, { module: r.module.path, text });
  else ctx.io.out(text);
  return EXIT.ok;
}

const notYet = (name: string) => (_args: Args, ctx: Ctx) => {
  ctx.io.err(`enou ${name}: not built yet`);
  return EXIT.refused;
};

export const runBrief = notYet("brief");
export const runShow = notYet("show");
