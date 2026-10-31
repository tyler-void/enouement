// Acceptance and rejection — the person's steps (FR-044, FR-044a, FR-046, FR-046a).
//
// Acceptance is the ONLY writer of `.knowledge/records/`. For each draft it validates again — the
// summary cap, kind rules, paths, the `supersedes` target and the no-fork rule, and the secret scan,
// because a person may have edited the draft — then writes the record canonically under the same id
// and removes the draft. Ids are taken in order; the first refusal stops the run, so the result says
// exactly which ids became records. Nothing here is offered to agents through MCP.

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { summaryCap } from "./capture";
import { isUlid } from "./id";
import type { ModulesConfig } from "./modules";
import { prepareRecord, type Issue } from "./record";
import { entryPath, loadStore, writeExclusive } from "./store";
import { buildTrust } from "./trust";

export interface StepResult {
  done: { id: string; path: string }[];
  refused?: { id: string; issues: Issue[] };
}

const refuse = (done: StepResult["done"], id: string, message: string, field = "id"): StepResult => ({
  done,
  refused: { id, issues: [{ field, message }] },
});

export function acceptDrafts(root: string, ids: readonly string[], modules: ModulesConfig): StepResult {
  const done: StepResult["done"] = [];
  for (const id of ids) {
    if (!isUlid(id)) return refuse(done, id, "is not a ULID");
    const snapshot = loadStore(root); // fresh each time: an earlier acceptance may supersede
    const trust = buildTrust(snapshot);
    const draft = snapshot.entries.find((e) => e.area === "inbox" && e.id === id);
    if (snapshot.entries.some((e) => e.area === "records" && e.id === id))
      return refuse(done, id, "is already a record — a record is superseded or redacted, not accepted again");
    if (!draft) return refuse(done, id, "is not a draft in .knowledge/inbox/");
    if (!draft.parsed.ok) return { done, refused: { id, issues: draft.parsed.issues } };
    const { data, body } = draft.parsed;

    const paths = Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === "string") : [];
    const prepared = prepareRecord(data, body, { maxSummary: summaryCap(modules, paths) });
    if (!prepared.ok) return { done, refused: { id, issues: prepared.issues } };

    const target = data.supersedes;
    if (typeof target === "string") {
      if (!trust.records.has(target))
        return refuse(
          done,
          id,
          trust.drafts.has(target)
            ? `supersedes ${target}, which is still a draft — accept or reject it first`
            : `supersedes ${target}, which is not a record`,
          "supersedes",
        );
      const already = trust.supersededBy.get(target);
      if (already?.length)
        return refuse(
          done,
          id,
          `supersedes ${target}, which ${already.join(", ")} already supersedes — supersede the newest record instead, so the chain does not fork (FR-046a)`,
          "supersedes",
        );
    }

    const recordRel = entryPath("records", id);
    writeExclusive(join(root, recordRel), prepared.text);
    unlinkSync(join(root, draft.path));
    done.push({ id, path: recordRel });
  }
  return { done };
}

export function rejectDrafts(root: string, ids: readonly string[]): StepResult {
  const done: StepResult["done"] = [];
  for (const id of ids) {
    if (!isUlid(id)) return refuse(done, id, "is not a ULID");
    const draft = join(root, entryPath("inbox", id));
    if (!existsSync(draft))
      return refuse(
        done,
        id,
        existsSync(join(root, entryPath("records", id)))
          ? "is a record — records are superseded or redacted, never rejected (FR-046)"
          : "is not a draft in .knowledge/inbox/",
      );
    unlinkSync(draft);
    done.push({ id, path: entryPath("inbox", id) });
  }
  return { done };
}
