// The integrity checks a brief adds once US5 provides them (tasks.md T063a): contradictions
// (FR-018) and dangling references (FR-016) among the records the brief returns. They reuse lint's
// checks rather than reimplementing them, against the working tree — what the person is about to
// change.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BriefCheck } from "./brief";
import { contradictions, danglingReferences } from "./lint";

export function integrityChecks(root: string): BriefCheck[] {
  return [
    {
      name: "contradiction",
      run: ({ trust, paths }) =>
        contradictions(trust, { paths }).map((c) => ({
          check: "contradiction",
          id: c.ids.join(", "),
          path: c.path ?? c.target,
          detail: c.message,
        })),
    },
    {
      name: "dangling-reference",
      run: ({ trust, modules, records }) =>
        danglingReferences(root, trust, { has: (p) => existsSync(join(root, p)) }, {
          ids: new Set(records.filter((r) => r.status === "current").map((r) => r.id)),
          symbolFiles: "all",
          modules,
        }).map((d) => ({ check: "dangling-reference", id: d.id, path: d.ref, detail: d.reason })),
    },
  ];
}
