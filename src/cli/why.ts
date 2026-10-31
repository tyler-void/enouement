// `enou why <path-or-symbol>` (FR-008–FR-010, FR-047, contracts/cli.md).

import { parseSymbol } from "../knowledge/record";
import { loadStore } from "../knowledge/store";
import { buildTrust } from "../knowledge/trust";
import { isPathQuestion, whyPath, whySymbol, type WhyAnswer, type WhyRecord } from "../knowledge/why";
import type { Args } from "./commands";
import { EXIT, json, modulesOrRefuse, repoPath, type Ctx } from "./util";

const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

export function answerWhy(ctx: Ctx, target: string, includeDrafts: boolean): WhyAnswer | { error: string } {
  const modules = modulesOrRefuse(ctx, "why");
  if (typeof modules === "number") return { error: "" }; // already reported
  const snapshot = loadStore(ctx.root);
  const opts = { includeDrafts };
  if (target.includes("#")) {
    const at = target.lastIndexOf("#");
    const r = repoPath(ctx, target.slice(0, at));
    if (!r.ok) return { error: r.message };
    const sym = parseSymbol(`${r.path}#${target.slice(at + 1)}`);
    if (typeof sym === "string") return { error: `${target}: ${sym}` };
    return whySymbol(ctx.root, snapshot, modules, sym.name, { ...opts, path: sym.path });
  }
  const r = repoPath(ctx, target);
  if (r.ok && isPathQuestion(ctx.root, buildTrust(snapshot), modules, r.path)) return whyPath(ctx.root, snapshot, modules, r.path, opts);
  if (IDENT.test(target)) return whySymbol(ctx.root, snapshot, modules, target, opts);
  return { error: r.ok ? `${target} is not a tracked path, a path any record mentions, or a symbol name` : r.message };
}

function renderRecord(r: WhyRecord, out: (t: string) => void) {
  const f = r.front;
  const mark =
    r.status === "superseded" ? `  [superseded by ${r.supersededBy.join(", ")}]` : r.status === "draft" ? "  [DRAFT — not accepted]" : "";
  out(`${r.id}  ${f.provenance.date}  ${f.kind}${mark}`);
  out(`  ${f.summary}`);
  for (const line of r.body.split("\n")) out(line ? `    ${line}` : "");
  if (f.rejected?.length) for (const x of f.rejected) out(`  rejected: ${x}`);
  const links = [
    f.spec ? `spec: ${f.spec}` : "",
    r.implementingCommit ? `commit: ${r.implementingCommit.slice(0, 7)}` : r.status === "draft" ? "" : "commit: not committed yet",
    f.commits?.length ? `describes: ${f.commits.join(", ")}` : "",
    f.supersedes ? `supersedes ${f.supersedes}` : "",
    f.provenance.origin !== "contemporaneous" ? `${f.provenance.origin}${f.provenance.source ? ` from ${f.provenance.source}` : ""}` : "",
  ].filter(Boolean);
  if (links.length) out(`  ${links.join(" · ")}`);
  out(`  matched: ${r.matchedBy.join("; ")}`);
  out("");
}

export function renderWhy(a: WhyAnswer, out: (t: string) => void): void {
  if (a.candidates) {
    out(`${a.query} — ambiguous, so no records are returned. ${a.note ?? ""}`);
    for (const c of a.candidates)
      out(`  ${c.path}${c.line ? `:${c.line}` : ""}${c.declaredBy ? ` (declared by ${c.declaredBy.join(", ")})` : ""}`);
    return;
  }
  if (a.kind === "symbol" && !a.resolvedPath) {
    out(`${a.query} — ${a.note ?? "not found"}. Nothing is inferred from the code.`);
    return;
  }
  const head = a.resolvedPath ? `${a.query} → ${a.resolvedPath}` : a.query;
  const also = a.names.length > 1 ? ` (also as ${a.names.slice(1).join(", ")})` : "";
  if (!a.records.length) out(`${head}${also} — no recorded knowledge. Nothing is inferred from the code.`);
  else out(`${head}${also} — ${a.records.length} record${a.records.length === 1 ? "" : "s"}, oldest first\n`);
  if (a.note && a.resolvedPath) out(`(${a.note})\n`);
  for (const r of a.records) renderRecord(r, out);
  if (!a.drafts.length && a.draftsWaiting)
    out(
      `${a.draftsWaiting} draft${a.draftsWaiting === 1 ? "" : "s"} about this path ${a.draftsWaiting === 1 ? "is" : "are"} waiting for acceptance and not shown — ` +
        "they are not knowledge yet (enou drafts; enou why --include-drafts)\n",
    );
  if (a.drafts.length) {
    out(`${a.drafts.length} draft${a.drafts.length === 1 ? "" : "s"} — NOT knowledge until a person accepts them:\n`);
    for (const r of a.drafts) renderRecord(r, out);
  }
  if (a.unreadable.length) {
    out(`warning: ${a.unreadable.length} record file${a.unreadable.length === 1 ? "" : "s"} could not be read, so this answer may be missing them:`);
    for (const u of a.unreadable) out(`  ${u.path}: ${u.issues.map((i) => `${i.field} ${i.message}`).join("; ")}`);
  }
}

export function whyJson(a: WhyAnswer): unknown {
  const rec = (r: WhyRecord) => ({
    id: r.id,
    status: r.status,
    superseded_by: r.supersededBy,
    kind: r.front.kind,
    date: r.front.provenance.date,
    summary: r.front.summary,
    body: r.body,
    paths: r.front.paths,
    symbols: r.front.symbols ?? [],
    rejected: r.front.rejected ?? [],
    spec: r.front.spec ?? null,
    supersedes: r.front.supersedes ?? null,
    provenance: r.front.provenance,
    implementing_commit: r.implementingCommit,
    file: r.path,
    matched_by: r.matchedBy,
  });
  return {
    query: a.query,
    kind: a.kind,
    resolved_path: a.resolvedPath ?? null,
    names: a.names,
    records: a.records.map(rec),
    drafts: a.drafts.map(rec),
    drafts_waiting: a.draftsWaiting,
    candidates: a.candidates ?? null,
    unreadable: a.unreadable,
    note: a.note ?? null,
  };
}

export function runWhy(args: Args, ctx: Ctx): number {
  const a = answerWhy(ctx, String(args.target), Boolean(args.include_drafts));
  if ("error" in a) {
    if (a.error) ctx.io.err(`enou why: ${a.error}`);
    return EXIT.refused;
  }
  if (args.json) json(ctx, whyJson(a));
  else renderWhy(a, (t) => ctx.io.out(t));
  return EXIT.ok;
}
