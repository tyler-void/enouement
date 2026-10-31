// `enou view` · `enou log` (FR-012–FR-014, FR-027*, FR-040) · `enou brief` (FR-011, FR-048) ·
// `enou show` — the read surface of US3.

import { brief, type Brief } from "../knowledge/brief";
import { integrityChecks } from "../knowledge/brief-checks";
import { isUlid } from "../knowledge/id";
import { loadStore } from "../knowledge/store";
import { buildTrust, statusOf } from "../knowledge/trust";
import { findModule, moduleView, renderLog, renderView } from "../knowledge/view";
import { implementingCommit, type WhyRecord } from "../knowledge/why";
import type { Args } from "./commands";
import { EXIT, json, list, modulesOrRefuse, repoPath, type Ctx } from "./util";
import { whyRecordJson } from "./why";

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

// ---------------------------------------------------------------------------------------------
// enou brief <path>...

function briefLine(r: WhyRecord): string {
  const mark =
    r.status === "superseded" ? `  [superseded by ${r.supersededBy.join(", ")}]` : r.status === "draft" ? "  [DRAFT — not accepted]" : "";
  return `  ${r.id}  ${r.front.provenance.date}  ${r.front.kind}${mark}\n    ${r.front.summary}`;
}

export function renderBrief(b: Brief): string {
  const out: string[] = [`brief: ${b.paths.join(", ")}`, ""];
  if (b.records.length) {
    out.push(`records (${b.records.length}, oldest first — enou show <id> for the full text)`);
    for (const r of b.records) out.push(briefLine(r));
  } else out.push("records: none recorded for these paths. Nothing is inferred from the code.");
  out.push("");
  if (b.views.length) {
    out.push("views");
    for (const v of b.views) out.push(v.text);
    out.push("");
  }
  if (b.gaps.length) {
    const width = Math.max(...b.gaps.map((g) => g.check.length)) + 2;
    out.push("gaps");
    for (const g of b.gaps) {
      const where = g.id ? `${g.id} (${g.path})` : (g.path ?? g.module ?? "");
      out.push(`  ${g.check.padEnd(width)}${where} — ${g.detail}`);
    }
  } else out.push("gaps: none found by the checks listed below");
  out.push("");
  if (b.drafts.length) {
    out.push(`drafts — NOT knowledge until a person accepts them`);
    for (const d of b.drafts) out.push(briefLine(d));
    out.push("");
  }
  if (b.unreadable.length) {
    out.push(`warning: ${b.unreadable.length} record file${b.unreadable.length === 1 ? "" : "s"} could not be read, so this brief may be missing them:`);
    for (const u of b.unreadable) out.push(`  ${u.path}: ${u.issues.map((i) => `${i.field} ${i.message}`).join("; ")}`);
    out.push("");
  }
  out.push(`checked: ${b.checked.join(", ")}`);
  return out.join("\n");
}

export function runBrief(args: Args, ctx: Ctx): number {
  const modules = modulesOrRefuse(ctx, "brief");
  if (typeof modules === "number") return modules;
  const paths: string[] = [];
  for (const p of list(args.paths)) {
    const r = repoPath(ctx, p);
    if (!r.ok) {
      ctx.io.err(`enou brief: ${r.message}`);
      return EXIT.refused;
    }
    paths.push(r.path);
  }
  const b = brief(ctx.root, loadStore(ctx.root), modules, paths, {
    includeDrafts: Boolean(args.include_drafts),
    checks: integrityChecks(ctx.root),
  });
  if (args.json)
    json(ctx, {
      paths: b.paths,
      records: b.records.map(whyRecordJson),
      views: b.views,
      gaps: b.gaps.map((g) => ({ check: g.check, path: g.path ?? null, module: g.module ?? null, id: g.id ?? null, detail: g.detail })),
      drafts: b.drafts.map(whyRecordJson),
      unreadable: b.unreadable,
      checked: b.checked,
    });
  else ctx.io.out(renderBrief(b));
  return EXIT.ok;
}

// ---------------------------------------------------------------------------------------------
// enou show <id>

export function runShow(args: Args, ctx: Ctx): number {
  const id = String(args.id);
  if (!isUlid(id)) {
    ctx.io.err(`enou show: ${id} is not a record id (a 26-character ULID)`);
    return EXIT.refused;
  }
  const snapshot = loadStore(ctx.root);
  const entry = snapshot.entries.find((e) => e.id === id && e.area === "records") ?? snapshot.entries.find((e) => e.id === id);
  if (!entry) {
    ctx.io.err(`enou show: no record or draft ${id}`);
    return EXIT.refused;
  }
  if (!entry.parsed.ok || (entry.area === "records" && entry.parsed.issues.length)) {
    ctx.io.err(`enou show: ${entry.path} cannot be read as a record:`);
    for (const i of entry.parsed.issues) ctx.io.err(`  ${i.field}: ${i.message}`);
    return EXIT.refused;
  }
  const { data, body } = entry.parsed;
  const problems = entry.parsed.issues;
  const trust = buildTrust(snapshot);
  const s = statusOf(trust, id);
  const status = entry.area === "inbox" ? "draft" : s.status === "superseded" ? "superseded" : "current";
  const by = s.status === "superseded" ? s.by : [];
  const commit = implementingCommit(ctx.root, id);

  if (args.json) {
    json(ctx, {
      id,
      status,
      superseded_by: by,
      front_matter: data,
      body,
      implementing_commit: commit,
      file: entry.path,
      problems,
    });
    return EXIT.ok;
  }

  const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const prov = (data.provenance ?? {}) as Record<string, unknown>;
  const red = data.redaction as Record<string, unknown> | undefined;
  const label =
    status === "draft" ? "DRAFT — not knowledge until a person accepts it" : status === "superseded" ? `record, superseded by ${by.join(", ")}` : "record, current";
  const rows: [string, string][] = [
    ["kind", str(data.kind)],
    ["summary", str(data.summary)],
    ["paths", Array.isArray(data.paths) ? data.paths.map(str).join(", ") : str(data.paths)],
  ];
  if (Array.isArray(data.symbols) && data.symbols.length) rows.push(["symbols", data.symbols.map(str).join(", ")]);
  if (data.spec !== undefined) rows.push(["spec", str(data.spec)]);
  if (data.supersedes !== undefined) rows.push(["supersedes", str(data.supersedes)]);
  rows.push(["provenance", [str(prov.origin), str(prov.date), prov.source !== undefined ? `source: ${str(prov.source)}` : ""].filter(Boolean).join(", ")]);
  if (Array.isArray(data.commits) && data.commits.length) rows.push(["describes", data.commits.map(str).join(", ")]);
  if (red) rows.push(["redaction", `${str(red.date)}: ${str(red.reason)} (fields: ${Array.isArray(red.fields) ? red.fields.map(str).join(", ") : str(red.fields)})`]);
  rows.push(["commit", commit ? `${commit} (derived: the commit that first added this file)` : "not committed yet"]);
  rows.push(["file", entry.path]);

  ctx.io.out(`${id}  ${label}`);
  for (const [k, v] of rows) ctx.io.out(`${k.padEnd(12)}${v}`);
  if (Array.isArray(data.rejected) && data.rejected.length) {
    ctx.io.out("rejected");
    for (const r of data.rejected) ctx.io.out(`  - ${str(r)}`);
  }
  if (problems.length) {
    ctx.io.out("problems (must be fixed before acceptance)");
    for (const p of problems) ctx.io.out(`  ${p.field}: ${p.message}`);
  }
  ctx.io.out("");
  ctx.io.out(body);
  return EXIT.ok;
}
