// Foundation integrity checks (data-model §2.8, FR-034, FR-041, FR-050) — tasks.md T011, T017;
// plan.md binding test #7.

import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitBase, lintStore, redactionProblem, type Base } from "../src/knowledge/lint";
import { serialiseRecord } from "../src/knowledge/record";
import { loadStore } from "../src/knowledge/store";
import { BODY, commitAll, front, gitInit, IDS, put, putRecord, tempRoot } from "./support/repo";

const checks = (root: string, base?: Base | string) => lintStore(loadStore(root), base).findings.map((f) => f.check);

describe("lintStore", () => {
  test("a clean store has no findings; drafts waiting are information, never findings", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.b }));
    put(root, `.knowledge/inbox/${IDS.c}.md`, "a half-edited draft"); // drafts may be mid-edit
    const r = lintStore(loadStore(root), { changes: [], read: () => null });
    expect(r.findings).toEqual([]);
    expect(r.info.draftsWaiting).toBe(2);
  });

  test("a record that does not parse is reported, never skipped (plan #7)", () => {
    const root = tempRoot();
    put(root, `.knowledge/records/${IDS.a}.md`, "---\nid: [unclosed\n---\nbody\n");
    const [f] = lintStore(loadStore(root)).findings;
    expect(f).toMatchObject({ check: "parse", path: `.knowledge/records/${IDS.a}.md`, field: "(file)" });
  });

  test("a record that fails validation is reported with its field", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ kind: "decision" }));
    expect(lintStore(loadStore(root)).findings).toContainEqual(
      expect.objectContaining({ check: "invalid", field: "rejected" }),
    );
  });

  test("non-canonical bytes are a finding: CRLF, a BOM, unquoted scalars", () => {
    const root = tempRoot();
    const text = serialiseRecord(front(), BODY);
    put(root, `.knowledge/records/${IDS.a}.md`, text.replace(/\n/g, "\r\n"));
    put(root, `.knowledge/records/${IDS.b}.md`, String.fromCharCode(0xfeff) + serialiseRecord(front({ id: IDS.b }), BODY));
    put(root, `.knowledge/records/${IDS.c}.md`, serialiseRecord(front({ id: IDS.c }), BODY).replace('kind: "gotcha"', "kind: gotcha"));
    expect(checks(root)).toEqual(["canonical", "canonical", "canonical"]);
  });

  test("the same id as both a draft and a record, and a non-flat layout, are findings", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.a }));
    put(root, ".knowledge/records/README.md", "notes");
    expect(checks(root).sort()).toEqual(["duplicate", "layout"]);
  });

  test("says so when immutability was not checked, instead of implying it passed", () => {
    const root = tempRoot();
    expect(lintStore(loadStore(root)).info.immutabilityNotChecked).toBeDefined();
    expect(lintStore(loadStore(root), "not a git repository").info.immutabilityNotChecked).toBe("not a git repository");
  });
});

describe("immutability (FR-007, FR-034)", () => {
  const before = serialiseRecord(front({ summary: "contains a mistake" }), BODY);
  const path = `.knowledge/records/${IDS.a}.md`;
  const base = (status: "modified" | "deleted" = "modified"): Base => ({ changes: [{ path, status }], read: () => before });

  test("an edit to an accepted record is a finding", () => {
    const root = tempRoot();
    put(root, path, serialiseRecord(front({ summary: "quietly corrected" }), BODY));
    expect(checks(root, base())).toEqual(["immutable"]);
  });

  test("deleting an accepted record is a finding", () => {
    expect(checks(tempRoot(), base("deleted"))).toEqual(["immutable"]);
  });

  test("a conforming redaction is permitted; one that also changes an unlisted field is not", () => {
    const redaction = { date: "2026-10-31", reason: "pasted a credential", fields: ["summary"] };
    const ok = serialiseRecord(front({ summary: "[redacted]", redaction }), BODY);
    expect(redactionProblem(before, ok)).toBeNull();
    const sneaky = serialiseRecord(front({ summary: "[redacted]", redaction, paths: ["src/other.ts"] }), BODY);
    expect(redactionProblem(before, sneaky)).toContain("paths");
    const bodyToo = serialiseRecord(front({ summary: "[redacted]", redaction }), "rewritten");
    expect(redactionProblem(before, bodyToo)).toContain("body");
  });

  test("against a real git history: only changed record files are read, and edits are caught", () => {
    const root = tempRoot();
    gitInit(root);
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "records", front({ id: IDS.b }));
    commitAll(root, "two records");
    const fresh = gitBase(root);
    expect(typeof fresh === "object" && fresh.changes).toEqual([]);

    const fileA = join(root, `.knowledge/records/${IDS.a}.md`);
    writeFileSync(fileA, readFileSync(fileA, "utf8").replace("an unquoted", "a bare"));
    rmSync(join(root, `.knowledge/records/${IDS.b}.md`));
    putRecord(root, "records", front({ id: IDS.c })); // a new record is not an edit
    expect(checks(root, gitBase(root))).toEqual(["immutable", "immutable"]);
  });

  test("gitBase explains itself when there is nothing to compare against", () => {
    expect(gitBase(tempRoot())).toBe("not a git repository");
    const root = tempRoot();
    gitInit(root);
    expect(gitBase(root)).toContain("does not name a commit");
  });
});
