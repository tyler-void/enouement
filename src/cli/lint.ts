// `enou lint [--staged | --range <a>..<b>] [--json]` (contracts/cli.md, contracts/hooks.md §1).
//
//   (no flag)  the working tree against HEAD — what you would commit if you committed everything;
//   --staged   the index against HEAD — what the next commit will contain (pre-commit hook);
//   --range    the commits in <a>..<b> — the only mode that judges FR-015, because it needs commit
//              messages (pre-push hook, CI).
// Exit 0 nothing to report · 1 bad arguments · 2 findings · 3 the tool failed. Information never
// sets exit 2.

import { collectChange, lintChange, lintStore, type LintResult, type Mode } from "../knowledge/lint";
import { loadStore } from "../knowledge/store";
import type { Args } from "./commands";
import { EXIT, json, type Ctx } from "./util";

export function runLint(args: Args, ctx: Ctx): number {
  if (args.staged && args.range !== undefined) {
    ctx.io.err("enou lint: give --staged or --range, not both");
    return EXIT.refused;
  }
  let mode: Mode = { kind: "worktree" };
  if (args.staged) mode = { kind: "staged" };
  if (args.range !== undefined) {
    // Git refs cannot contain "..", so the first ".." splits the range; "..." is refused.
    const r = String(args.range);
    const at = r.indexOf("..");
    if (at <= 0 || r.includes("...") || at + 2 >= r.length || /\s/.test(r)) {
      ctx.io.err(`enou lint: --range must be <a>..<b>, got ${JSON.stringify(args.range)}`);
      return EXIT.refused;
    }
    mode = { kind: "range", from: r.slice(0, at), to: r.slice(at + 2) };
  }

  let result: LintResult;
  const change = collectChange(ctx.root, mode);
  if (typeof change === "string") {
    if (mode.kind !== "worktree") {
      ctx.io.err(`enou lint: ${change}`);
      return EXIT.refused;
    }
    // Outside git, the store can still be checked; say what could not be.
    result = lintStore(loadStore(ctx.root), change);
    result.info.notChecked.push(`checks against a change: ${change}`);
  } else {
    try {
      result = lintChange(ctx.root, change);
    } finally {
      change.cleanup();
    }
  }

  const { findings, info } = result;
  if (args.json)
    json(ctx, {
      mode: mode.kind,
      findings: findings.map((f) => ({ check: f.check, path: f.path, field: f.field ?? null, message: f.message })),
      drafts_waiting: info.draftsWaiting,
      drafts: info.drafts,
      immutability_not_checked: info.immutabilityNotChecked ?? null,
      not_checked: info.notChecked,
      uncovered: info.uncovered,
      unlinked_decisions: info.unlinkedDecisions,
      dangling_before: info.danglingBefore,
    });
  else {
    const out = (t: string) => ctx.io.out(t);
    for (const f of findings) out(`${f.path}: [${f.check}]${f.field ? ` ${f.field}` : ""} ${f.message}`);
    for (const u of info.uncovered)
      out(`info: removing module ${u.module} leaves ${u.records} record${u.records === 1 ? "" : "s"} in no module (FR-039); they still answer enou why`);
    for (const d of info.unlinkedDecisions)
      out(`info: ${d.ids[0]} and ${d.ids[1]} are both current decisions about ${d.path} — if one replaces the other, supersede it`);
    for (const d of info.danglingBefore) out(`info: ${d.id} refers to ${d.ref}, which was already dangling before this change: ${d.reason}`);
    if (info.immutabilityNotChecked) out(`not checked: immutability — ${info.immutabilityNotChecked}`);
    for (const n of info.notChecked) out(`not checked: ${n}`);
    if (info.draftsWaiting)
      out(`${info.draftsWaiting} draft${info.draftsWaiting === 1 ? "" : "s"} waiting in .knowledge/inbox/ for a person to accept (enou drafts)`);
    out(findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"}` : "no findings");
  }
  return findings.length ? EXIT.findings : EXIT.ok;
}
