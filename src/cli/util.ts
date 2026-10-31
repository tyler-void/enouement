// Small pieces every command handler shares.

import { loadModules, type ModulesConfig } from "../knowledge/modules";
import type { Issue } from "../knowledge/record";
import type { Io } from "./main";
import { toRepoPath } from "./root";

export interface Ctx {
  root: string;
  io: Io;
}

export const EXIT = { ok: 0, refused: 1, findings: 2, internal: 3 } as const;

/** Print a refusal: one `field: message` line per issue, on stderr. Returns exit 1. */
export function refuse(ctx: Ctx, what: string, issues: readonly Issue[]): number {
  ctx.io.err(`enou ${what}: refused — nothing was written`);
  for (const i of issues) ctx.io.err(`  ${i.field}: ${i.message}`);
  return EXIT.refused;
}

export function json(ctx: Ctx, value: unknown): void {
  ctx.io.out(JSON.stringify(value, null, 2));
}

/** modules.yaml, or a refusal naming what is wrong with it — never a silent default. */
export function modulesOrRefuse(ctx: Ctx, what: string): ModulesConfig | number {
  const r = loadModules(ctx.root);
  if (r.ok) return r.config;
  return refuse(ctx, what, r.issues.map((i) => ({ field: `.knowledge/modules.yaml ${i.field}`, message: i.message })));
}

/** A path argument (relative to the current directory) as a repository path; keeps a trailing `/`. */
export function repoPath(ctx: Ctx, arg: string): { ok: true; path: string } | { ok: false; message: string } {
  const r = toRepoPath(ctx.root, ctx.io.cwd, arg);
  if (!r.ok) return r;
  return { ok: true, path: arg.endsWith("/") && r.path !== "." ? `${r.path}/` : r.path };
}

export function list(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : v === undefined ? [] : [String(v)];
}
