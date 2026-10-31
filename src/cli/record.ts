// `enou record` — capture a draft (FR-043, contracts/cli.md). Never writes a record.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { draftData, summaryCap } from "../knowledge/capture";
import type { Kind, Origin } from "../knowledge/record";
import { loadStore, writeDraft } from "../knowledge/store";
import type { Args } from "./commands";
import { EXIT, json, list, modulesOrRefuse, refuse, repoPath, type Ctx } from "./util";

export function runRecord(args: Args, ctx: Ctx): number {
  const modules = modulesOrRefuse(ctx, "record");
  if (typeof modules === "number") return modules;

  if (args.body !== undefined && args.body_file !== undefined)
    return refuse(ctx, "record", [{ field: "body", message: "give --body or --body-file, not both" }]);
  let body: string;
  if (args.body !== undefined) body = String(args.body);
  else if (args.body_file !== undefined) {
    const f = String(args.body_file);
    try {
      body = f === "-" ? (ctx.io.stdin ? ctx.io.stdin() : readFileSync(0, "utf8")) : readFileSync(resolve(ctx.io.cwd, f), "utf8");
    } catch (e) {
      return refuse(ctx, "record", [{ field: "body-file", message: `cannot read ${f}: ${(e as Error).message}` }]);
    }
  } else
    return refuse(ctx, "record", [
      { field: "body", message: "a record says what is true and why: give --body, --body-file <file>, or --body-file -" },
    ]);

  const issues: { field: string; message: string }[] = [];
  const conv = (field: string, values: string[]) =>
    values.map((v, i) => {
      const r = repoPath(ctx, v);
      if (!r.ok) issues.push({ field: `${field}[${i}]`, message: r.message });
      return r.ok ? r.path : v;
    });
  const paths = conv("paths", list(args.paths));
  const symbols = list(args.symbol).map((s, i) => {
    const at = s.lastIndexOf("#");
    if (at <= 0) return s; // validation reports the malformed symbol
    const r = repoPath(ctx, s.slice(0, at));
    if (!r.ok) issues.push({ field: `symbols[${i}]`, message: r.message });
    return r.ok ? `${r.path}#${s.slice(at + 1)}` : s;
  });
  const spec = args.spec === undefined ? undefined : conv("spec", [String(args.spec)])[0];
  if (issues.length) return refuse(ctx, "record", issues);

  const data = draftData({
    kind: args.kind as Kind,
    summary: String(args.summary),
    paths,
    body,
    symbols,
    rejected: list(args.rejected),
    supersedes: args.supersedes === undefined ? undefined : String(args.supersedes),
    origin: args.provenance as Origin | undefined,
    source: args.source === undefined ? undefined : String(args.source),
    spec,
    commits: list(args.commit),
  });

  const result = writeDraft(loadStore(ctx.root), data, body, { maxSummary: summaryCap(modules, paths) });
  if (!result.ok) return refuse(ctx, "record", result.issues);
  if (args.json) json(ctx, { id: result.id, path: result.path, status: "draft", ...data });
  else {
    ctx.io.out(`draft ${result.id} written to ${result.path}`);
    ctx.io.out(`It is not knowledge yet. A person reads it, edits it if needed, and runs: enou accept ${result.id}`);
  }
  return EXIT.ok;
}
