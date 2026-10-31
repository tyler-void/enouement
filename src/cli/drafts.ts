// `enou drafts` · `enou accept` · `enou reject` (FR-044, FR-046, contracts/cli.md).

import { acceptDrafts, rejectDrafts, type StepResult } from "../knowledge/accept";
import { loadStore } from "../knowledge/store";
import { buildTrust } from "../knowledge/trust";
import { relates } from "../knowledge/why";
import type { Args } from "./commands";
import { EXIT, json, list, modulesOrRefuse, repoPath, type Ctx } from "./util";

export function runDrafts(args: Args, ctx: Ctx): number {
  const snapshot = loadStore(ctx.root);
  const trust = buildTrust(snapshot);
  const filter: string[] = [];
  for (const p of list(args.paths)) {
    const r = repoPath(ctx, p);
    if (!r.ok) {
      ctx.io.err(`enou drafts: ${r.message}`);
      return EXIT.refused;
    }
    filter.push(r.path);
  }
  const rows = snapshot.entries
    .filter((e) => e.area === "inbox" && !trust.records.has(e.id))
    .map((e) => {
      const d = e.parsed.ok ? e.parsed.data : {};
      return {
        id: e.id,
        path: e.path,
        kind: typeof d.kind === "string" ? d.kind : null,
        summary: typeof d.summary === "string" ? d.summary : null,
        paths: Array.isArray(d.paths) ? (d.paths as string[]) : [],
        problems: e.parsed.issues,
      };
    })
    .filter((r) => !filter.length || r.paths.some((p) => filter.some((f) => relates(p, f))));

  if (args.json) json(ctx, { drafts: rows });
  else if (!rows.length) ctx.io.out("no drafts waiting");
  else {
    for (const r of rows) {
      ctx.io.out(`${r.id}  ${r.kind ?? "?"}  ${r.summary ?? "(unreadable)"}`);
      ctx.io.out(`  ${r.path}${r.paths.length ? ` · ${r.paths.join(", ")}` : ""}`);
      for (const p of r.problems) ctx.io.out(`  ! ${p.field}: ${p.message}`);
    }
    ctx.io.out(`\n${rows.length} draft${rows.length === 1 ? "" : "s"} waiting. Read each, edit if needed, then: enou accept <id>... (or enou reject <id>...)`);
  }
  return EXIT.ok;
}

function report(ctx: Ctx, verb: string, r: StepResult, asJson: boolean): number {
  if (asJson) json(ctx, { done: r.done, refused: r.refused ?? null });
  else {
    for (const d of r.done) ctx.io.out(`${verb} ${d.id}${verb === "accepted" ? ` → ${d.path}` : ""}`);
    if (r.refused) {
      ctx.io.err(`enou ${verb === "accepted" ? "accept" : "reject"}: refused ${r.refused.id}${r.done.length ? " (the ids above were done; the rest were not attempted)" : ""}`);
      for (const i of r.refused.issues) ctx.io.err(`  ${i.field}: ${i.message}`);
    }
  }
  return r.refused ? EXIT.refused : EXIT.ok;
}

export function runAccept(args: Args, ctx: Ctx): number {
  const modules = modulesOrRefuse(ctx, "accept");
  if (typeof modules === "number") return modules;
  return report(ctx, "accepted", acceptDrafts(ctx.root, list(args.ids), modules), Boolean(args.json));
}

export function runReject(args: Args, ctx: Ctx): number {
  return report(ctx, "rejected", rejectDrafts(ctx.root, list(args.ids)), Boolean(args.json));
}
