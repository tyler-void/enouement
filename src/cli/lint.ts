// `enou lint` — the foundation checks (tasks.md T011), against the working tree and HEAD.
// The `--staged` and `--range` modes and the PR flags arrive with US5 (T062–T067).

import { gitBase, lintStore } from "../knowledge/lint";
import { loadStore } from "../knowledge/store";
import type { Args } from "./commands";
import type { Io } from "./main";

export function runLint(args: Args, ctx: { root: string; io: Io }): number {
  const snapshot = loadStore(ctx.root);
  const result = lintStore(snapshot, gitBase(ctx.root));
  const { findings, info } = result;
  if (args.json) {
    ctx.io.out(
      JSON.stringify(
        {
          findings: findings.map((f) => ({ check: f.check, path: f.path, field: f.field ?? null, message: f.message })),
          drafts_waiting: info.draftsWaiting,
          immutability_not_checked: info.immutabilityNotChecked ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    for (const f of findings) ctx.io.out(`${f.path}: [${f.check}]${f.field ? ` ${f.field}` : ""} ${f.message}`);
    if (info.immutabilityNotChecked)
      ctx.io.out(`immutability not checked: ${info.immutabilityNotChecked}`);
    if (info.draftsWaiting)
      ctx.io.out(`${info.draftsWaiting} draft${info.draftsWaiting === 1 ? "" : "s"} waiting in .knowledge/inbox/ for a person to accept`);
    ctx.io.out(findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"}` : "no findings");
  }
  return findings.length ? 2 : 0;
}
