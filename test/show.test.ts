// `enou show <id>` — US3 (tasks.md T044a).

import { describe, expect, test } from "bun:test";
import { enou } from "./support/cli";
import { commitAll, front, gitInit, put, putRecord, sh, tempRoot } from "./support/repo";

const ids = Array.from({ length: 4 }, (_, i) => `01JBQ7K3M2N8P4R6T9V0W1X${"ABCD"[i]}AA`);

describe("enou show", () => {
  test("a current record: every field, the body, and the derived implementing commit", async () => {
    const root = tempRoot();
    gitInit(root);
    putRecord(root, "records", front({
      id: ids[0], kind: "decision", rejected: ["keep it mutable"], summary: "records are immutable",
      paths: ["src/knowledge/"], symbols: ["src/knowledge/store.ts#writeDraft"], spec: "specs/001/spec.md",
    }), "Corrections are made by superseding.");
    commitAll(root, "record");
    const sha = sh(root, "git", ["rev-parse", "HEAD"]).trim();
    const r = await enou(root, ["show", ids[0]]);
    expect(r.code).toBe(0);
    for (const s of ["record, current", "decision", "records are immutable", "src/knowledge/", "src/knowledge/store.ts#writeDraft",
      "specs/001/spec.md", "keep it mutable", "Corrections are made by superseding.", sha])
      expect(r.out).toContain(s);
    const j = JSON.parse((await enou(root, ["show", ids[0], "--json"])).out);
    expect(j).toMatchObject({ id: ids[0], status: "current", implementing_commit: sha, file: `.knowledge/records/${ids[0]}.md` });
  });

  test("a superseded record names what replaced it — what a raw file cannot show (FR-040a)", async () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: ids[0] }));
    putRecord(root, "records", front({ id: ids[1], supersedes: ids[0] }));
    const r = await enou(root, ["show", ids[0]]);
    expect(r.out).toContain(`superseded by ${ids[1]}`);
    expect(r.out).toContain("not committed yet");
  });

  test("a draft is labelled as not knowledge, and its problems are listed rather than refused", async () => {
    const root = tempRoot();
    putRecord(root, "inbox", front({ id: ids[2], kind: "decision" })); // no `rejected` yet: mid-edit
    const r = await enou(root, ["show", ids[2]]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("DRAFT — not knowledge until a person accepts it");
    expect(r.out).toContain("rejected: is required for a decision");
  });

  test("refuses an unknown id, a malformed id, and an unreadable record", async () => {
    const root = tempRoot();
    put(root, `.knowledge/records/${ids[3]}.md`, "not a record");
    expect((await enou(root, ["show", ids[0]])).err).toContain("no record or draft");
    expect((await enou(root, ["show", "nope"])).code).toBe(1);
    const bad = await enou(root, ["show", ids[3]]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("cannot be read");
  });
});
