// `enou brief` — US3 (tasks.md T044b, T055e, T055f; plan.md binding tests #14, #22; SC-014).

import { describe, expect, test } from "bun:test";
import { BRIEF_CHECKS } from "../src/knowledge/brief";
import { enou } from "./support/cli";
import { front, put, putRecord, tempRoot } from "./support/repo";

// Ids in creation order.
const ids = Array.from({ length: 8 }, (_, i) => `01JBQ7K3M2N8P4R6T9V0W1X${"ABCDEFGH"[i]}AA`);

function repo() {
  const root = tempRoot();
  put(root, ".knowledge/modules.yaml", "modules:\n  - path: src/util\n  - path: src/empty\n");
  put(root, "src/util/a.ts", "export function a() {}\n");
  put(root, "docs/x.md", "notes\n");
  putRecord(root, "records", front({ id: ids[0], kind: "invariant", summary: "a never throws", paths: ["src/util/a.ts"] }));
  putRecord(root, "records", front({ id: ids[1], kind: "gotcha", summary: "the util dir is shared", paths: ["src/util/"] }));
  return root;
}

const briefJson = async (root: string, argv: string[]) => {
  const r = await enou(root, ["brief", ...argv, "--json"]);
  if (r.code !== 0) throw new Error(r.err);
  return JSON.parse(r.out);
};

describe("enou brief", () => {
  test("records for the paths, deduplicated by id, oldest first; the touched modules' views", async () => {
    const root = repo();
    const b = await briefJson(root, ["src/util/a.ts", "src/util/"]);
    expect(b.records.map((r: { id: string }) => r.id)).toEqual([ids[0], ids[1]]);
    expect(b.views.map((v: { module: string }) => v.module)).toEqual(["src/util"]);
    expect(b.views[0].text).toContain("a never throws");
  });

  test("gaps: an uncovered path, a module with no knowledge, and the checks that ran", async () => {
    const b = await briefJson(repo(), ["src/util/a.ts", "docs/x.md", "src/empty/z.ts"]);
    expect(b.gaps.map((g: { check: string; path: string | null; module: string | null }) => [g.check, g.path ?? g.module])).toEqual([
      ["uncovered-path", "docs/x.md"],
      ["module-without-knowledge", "src/empty"],
    ]);
    expect(b.checked).toEqual([...BRIEF_CHECKS, "contradiction", "dangling-reference"]);
  });

  test("a module whose records are all superseded is a gap too", async () => {
    const root = repo();
    putRecord(root, "records", front({ id: ids[2], summary: "old", paths: ["src/empty/z.ts"] }));
    putRecord(root, "records", front({ id: ids[3], summary: "moved away", paths: ["elsewhere/z.ts"], supersedes: ids[2] }));
    const b = await briefJson(root, ["src/empty/z.ts"]);
    expect(b.gaps).toContainEqual(expect.objectContaining({ check: "module-without-knowledge", module: "src/empty", detail: expect.stringContaining("superseded") }));
  });

  test("always lists every check it ran, and two briefs over the same records are byte-identical (T055f, SC-014)", async () => {
    const root = repo();
    for (const argv of [["src/util/a.ts"], ["docs/x.md"], ["src/util/a.ts", "docs/x.md", "src/empty/z.ts"]]) {
      const a = await enou(root, ["brief", ...argv]);
      const b = await enou(root, ["brief", ...argv]);
      expect(a.out).toBe(b.out);
      expect(a.out).toContain(`checked: ${[...BRIEF_CHECKS, "contradiction", "dangling-reference"].join(", ")}`);
    }
  });

  test("paths all outside every module: zero records, every path uncovered, checks still listed (T055f)", async () => {
    const root = repo();
    const b = await briefJson(root, ["docs/x.md", "README.md"]);
    expect(b.records).toEqual([]);
    expect(b.gaps.map((g: { check: string }) => g.check)).toEqual(["uncovered-path", "uncovered-path"]);
    expect(b.checked.length).toBeGreaterThan(0);
    expect((await enou(root, ["brief", "docs/x.md"])).out).toContain("records: none recorded for these paths");
  });

  test("paths are taken relative to the current directory", async () => {
    const root = repo();
    const b = await briefJson(`${root}/src`, ["util/a.ts"]);
    expect(b.paths).toEqual(["src/util/a.ts"]);
  });
});

describe("drafts never surface as knowledge without --include-drafts (T055e, plan #14)", () => {
  const SECRET = "DRAFT SUMMARY THAT MUST NOT LEAK";

  function withDraft() {
    const root = repo();
    putRecord(root, "inbox", front({ id: ids[5], kind: "gotcha", summary: SECRET, paths: ["src/util/a.ts"] }));
    return root;
  }

  test("brief: a waiting draft is a gap naming its id and paths, never its content", async () => {
    const root = withDraft();
    const text = (await enou(root, ["brief", "src/util/a.ts"])).out;
    expect(text).not.toContain(SECRET);
    expect(text).toContain(`drafts-waiting`);
    expect(text).toContain(ids[5]);
    const b = await briefJson(root, ["src/util/a.ts"]);
    expect(b.drafts).toEqual([]);
    expect(JSON.stringify(b)).not.toContain(SECRET);
  });

  test("brief with --include-drafts lists them apart, labelled", async () => {
    const root = withDraft();
    const text = (await enou(root, ["brief", "src/util/a.ts", "--include-drafts"])).out;
    expect(text).toContain("drafts — NOT knowledge until a person accepts them");
    expect(text).toContain(SECRET);
    expect((await briefJson(root, ["src/util/a.ts", "--include-drafts"])).drafts[0].status).toBe("draft");
  });

  test("view and log never show it either", async () => {
    const root = withDraft();
    for (const cmd of ["view", "log"]) {
      expect((await enou(root, [cmd, "src/util"])).out).not.toContain(SECRET);
      expect((await enou(root, [cmd, "src/util", "--include-drafts"])).out).toContain(SECRET);
    }
  });

  test("a draft that supersedes a record leaves it in the brief as current", async () => {
    const root = repo();
    putRecord(root, "inbox", front({ id: ids[6], summary: "replacement", paths: ["src/util/a.ts"], supersedes: ids[0] }));
    const b = await briefJson(root, ["src/util/a.ts"]);
    expect(b.records.find((r: { id: string }) => r.id === ids[0]).status).toBe("current");
  });
});

// T063a — once US5 exists, a brief also checks contradictions and dangling references.
import { putRecord as putRec, front as fm, tempRoot as tmp, put as putFile, IDS as I } from "./support/repo";
import { enou as run } from "./support/cli";

describe("brief: integrity checks (T063a)", () => {
  test("lists contradiction and dangling-reference among the checks, and reports both", async () => {
    const root = tmp();
    putFile(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n");
    putFile(root, "src/a.ts", "");
    putRec(root, "records", fm({ id: I.a, paths: ["src/a.ts"] }));
    putRec(root, "records", fm({ id: I.b, paths: ["src/a.ts"], supersedes: I.a }));
    putRec(root, "records", fm({ id: I.c, paths: ["src/a.ts"], supersedes: I.a }));
    putRec(root, "records", fm({ id: I.d, paths: ["src/a.ts", "src/gone.ts"] }));
    const r = await run(root, ["brief", "src/a.ts", "--json"]);
    expect(r.code).toBe(0);
    const b = JSON.parse(r.out);
    expect(b.checked).toContain("contradiction");
    expect(b.checked).toContain("dangling-reference");
    const checks = b.gaps.map((g: { check: string }) => g.check);
    expect(checks).toContain("contradiction");
    expect(b.gaps.find((g: { check: string }) => g.check === "dangling-reference")).toMatchObject({ id: I.d, path: "src/gone.ts" });
  });
});
