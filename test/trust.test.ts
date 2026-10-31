// The trust predicate (data-model §2.2) — tasks.md T017b, plan.md binding test #14 (core part).

import { describe, expect, test } from "bun:test";
import { loadStore } from "../src/knowledge/store";
import { buildTrust, statusOf } from "../src/knowledge/trust";
import { front, IDS, put, putRecord, tempRoot } from "./support/repo";

describe("trust", () => {
  test("a draft beside every record is never knowledge", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "records", front({ id: IDS.b }));
    putRecord(root, "inbox", front({ id: IDS.c }));
    putRecord(root, "inbox", front({ id: IDS.d }));
    const view = buildTrust(loadStore(root));
    expect([...view.records.keys()]).toEqual([IDS.a, IDS.b]);
    expect([...view.drafts.keys()]).toEqual([IDS.c, IDS.d]);
    expect(statusOf(view, IDS.c)).toEqual({ status: "draft" });
  });

  test("a draft that supersedes a record leaves it current; an accepted one supersedes it", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.b, supersedes: IDS.a }));
    expect(statusOf(buildTrust(loadStore(root)), IDS.a)).toEqual({ status: "current" });

    putRecord(root, "records", front({ id: IDS.c, supersedes: IDS.a }));
    expect(statusOf(buildTrust(loadStore(root)), IDS.a)).toEqual({ status: "superseded", by: [IDS.c] });
  });

  test("an invalid file in records/ is not knowledge, cannot supersede anything, and is listed", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "records", front({ id: IDS.b, supersedes: IDS.a, kind: "decision" })); // no `rejected`
    put(root, `.knowledge/records/${IDS.c}.md`, "not a record");
    const view = buildTrust(loadStore(root));
    expect([...view.records.keys()]).toEqual([IDS.a]);
    expect(statusOf(view, IDS.a)).toEqual({ status: "current" });
    expect(view.invalid.map((x) => x.path)).toEqual([`.knowledge/records/${IDS.b}.md`, `.knowledge/records/${IDS.c}.md`]);
  });

  test("when an id is both a record and a draft, the record is authoritative", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.a, summary: "a stray copy" }));
    const view = buildTrust(loadStore(root));
    expect(view.records.get(IDS.a)!.front.summary).toBe(front().summary as string);
    expect(view.drafts.has(IDS.a)).toBe(false);
  });

  test("two accepted successors of one record are both reported, in id order — a fork is visible", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "records", front({ id: IDS.c, supersedes: IDS.a }));
    putRecord(root, "records", front({ id: IDS.b, supersedes: IDS.a }));
    expect(statusOf(buildTrust(loadStore(root)), IDS.a)).toEqual({ status: "superseded", by: [IDS.b, IDS.c] });
  });
});
