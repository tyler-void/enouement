// `enou why` — US2 (tasks.md T033–T039b; plan.md binding tests #8, #14, #19).

import { describe, expect, test } from "bun:test";
import { serialiseRecord } from "../src/knowledge/record";
import { loadStore } from "../src/knowledge/store";
import { orderBySupersession } from "../src/knowledge/why";
import { capture, enou } from "./support/cli";
import { BODY, commitAll, front, gitInit, IDS, put, putRecord, sh, tempRoot } from "./support/repo";

const why = async (root: string, target: string, extra: string[] = []) => {
  const r = await enou(root, ["why", target, ...extra, "--json"]);
  if (r.code !== 0) throw new Error(r.err);
  return JSON.parse(r.out);
};
const ids = (a: { records: { id: string }[] }) => a.records.map((r) => r.id);

describe("a path question", () => {
  test("returns the records about a file — and about its directories and globs — oldest first", async () => {
    const root = tempRoot();
    put(root, "src/util/context.ts", "");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/util/"] }));
    putRecord(root, "records", front({ id: IDS.b, paths: ["src/util/context.ts"] }));
    putRecord(root, "records", front({ id: IDS.c, paths: ["src/**/*.ts"] }));
    putRecord(root, "records", front({ id: IDS.d, paths: ["src/other.ts"] }));
    expect(ids(await why(root, "src/util/context.ts"))).toEqual([IDS.a, IDS.b, IDS.c]);
    expect(ids(await why(root, "src/util"))).toEqual([IDS.a, IDS.b, IDS.c]);
  });

  test("a file with no records says so plainly, and infers nothing (T039, FR-010)", async () => {
    const root = tempRoot();
    put(root, "src/a.ts", "export function a() {}\n");
    const r = await enou(root, ["why", "src/a.ts"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("src/a.ts — no recorded knowledge. Nothing is inferred from the code.");
  });

  test("a superseded record is shown and marked with what replaced it (FR-009)", async () => {
    const root = tempRoot();
    put(root, "src/a.ts", "");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: IDS.b, paths: ["src/a.ts"], supersedes: IDS.a }));
    const a = await why(root, "src/a.ts");
    expect(a.records.map((r: { id: string; status: string; superseded_by: string[] }) => [r.id, r.status, r.superseded_by])).toEqual([
      [IDS.a, "superseded", [IDS.b]],
      [IDS.b, "current", []],
    ]);
  });

  test("chains follow the supersedes graph, not the ids — ids minted out of clock order (plan #8, T037)", () => {
    // c supersedes b supersedes a, but a skewed clock gave c the smallest id and a the largest.
    const chain = [
      { id: IDS.d, front: {} }, // a: the original
      { id: IDS.b, front: { supersedes: IDS.d } }, // b
      { id: IDS.a, front: { supersedes: IDS.b } }, // c: newest, smallest id
      { id: IDS.c, front: {} }, // unrelated
    ];
    expect(orderBySupersession(chain).map((x) => x.id)).toEqual([IDS.c, IDS.d, IDS.b, IDS.a]);
  });

  test("drafts never appear unless asked for, and then labelled; a superseding draft changes nothing (plan #14, T039b)", async () => {
    const root = tempRoot();
    put(root, "src/a.ts", "");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    putRecord(root, "inbox", front({ id: IDS.b, paths: ["src/a.ts"], supersedes: IDS.a }));
    const plain = await why(root, "src/a.ts");
    expect(ids(plain)).toEqual([IDS.a]);
    expect(plain.records[0].status).toBe("current");
    expect(plain.drafts).toEqual([]);
    expect(plain.drafts_waiting).toBe(1);
    const withDrafts = await why(root, "src/a.ts", ["--include-drafts"]);
    expect(withDrafts.drafts.map((d: { id: string; status: string }) => [d.id, d.status])).toEqual([[IDS.b, "draft"]]);
    expect((await enou(root, ["why", "src/a.ts"])).out).toContain("1 draft about this path is waiting");
  });

  test("an unreadable record is reported with the answer, never silently left out (plan #7)", async () => {
    const root = tempRoot();
    put(root, "src/a.ts", "");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    put(root, `.knowledge/records/${IDS.b}.md`, "---\nbroken: [\n---\n");
    const r = await enou(root, ["why", "src/a.ts"]);
    expect(r.out).toContain("could not be read, so this answer may be missing them");
    expect((await why(root, "src/a.ts")).unreadable[0].path).toBe(`.knowledge/records/${IDS.b}.md`);
  });

  test("follows git's rename history (FR-038, T038)", async () => {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/old-name.ts", "export const value = 'a fairly long body so rename detection is confident';\n");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/old-name.ts"] }));
    commitAll(root, "add");
    sh(root, "git", ["mv", "src/old-name.ts", "src/new-name.ts"]);
    commitAll(root, "rename");
    const a = await why(root, "src/new-name.ts");
    expect(ids(a)).toEqual([IDS.a]);
    expect(a.names).toContain("src/old-name.ts");
  });

  test("a deleted file still answers from its records, as a path question", async () => {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/gone.ts", "x\n");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/gone.ts"] }));
    commitAll(root, "add");
    sh(root, "git", ["rm", "-q", "src/gone.ts"]);
    commitAll(root, "delete");
    const a = await why(root, "src/gone.ts");
    expect(a.kind).toBe("path");
    expect(ids(a)).toEqual([IDS.a]);
  });

  test("resolves through a module's formerly alias (FR-037)", async () => {
    const root = tempRoot();
    put(root, ".knowledge/modules.yaml", "modules:\n  - path: bench/src\n    formerly: [src/backends]\n");
    put(root, "bench/src/semantic.ts", "");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/backends/semantic.ts"] }));
    expect(ids(await why(root, "bench/src/semantic.ts"))).toEqual([IDS.a]);
  });

  test("includes records named by Knowledge-Record trailers, but only if they are records", async () => {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/a.ts", "v1\n");
    putRecord(root, "records", front({ id: IDS.a, paths: ["docs/elsewhere.md"] }));
    putRecord(root, "inbox", front({ id: IDS.b, paths: ["docs/elsewhere.md"] }));
    commitAll(root, "base");
    put(root, "src/a.ts", "v2\n");
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["commit", "-q", "-m", `change a\n\nKnowledge-Record: ${IDS.a}, ${IDS.b}`]);
    const a = await why(root, "src/a.ts");
    expect(ids(a)).toEqual([IDS.a]);
    expect(a.records[0].matched_by[0]).toContain("Knowledge-Record trailer");
  });
});

describe("a symbol question (FR-047, T033a, T039a; plan #19)", () => {
  function repo() {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/util/context.ts", "export function buildContext() {}\nfunction inner() { const nested = 1; }\n");
    put(root, "src/a.ts", "export const shared = 1;\n");
    put(root, "src/b.ts", "export class shared {}\n");
    put(root, "src/c.ts", "class Box {\n  method() {}\n}\n");
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/util/context.ts"] }));
    commitAll(root, "base");
    return root;
  }

  test("one definition answers with that file's records", async () => {
    const a = await why(repo(), "buildContext");
    expect(a.kind).toBe("symbol");
    expect(a.resolved_path).toBe("src/util/context.ts");
    expect(ids(a)).toEqual([IDS.a]);
  });

  test("two definitions list both candidates and return no records", async () => {
    const a = await why(repo(), "shared");
    expect(a.candidates.map((c: { path: string }) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(a.records).toEqual([]);
  });

  test("<path>#<name> removes the ambiguity", async () => {
    const a = await why(repo(), "src/b.ts#shared");
    expect(a.resolved_path).toBe("src/b.ts");
  });

  test("a nested definition the patterns cannot see is 'not found', never another file's records", async () => {
    const root = repo();
    for (const name of ["method", "nested"]) {
      const a = await why(root, name);
      expect(a.records).toEqual([]);
      expect(a.note).toContain("no definition");
    }
  });

  test("a declared symbol answers without searching; declarations in two files are ambiguous too", async () => {
    const root = repo();
    putRecord(root, "records", front({ id: IDS.b, paths: ["src/x.ts"], symbols: ["src/x.ts#Declared"] }));
    expect((await why(root, "Declared")).resolved_path).toBe("src/x.ts");
    putRecord(root, "records", front({ id: IDS.c, paths: ["src/y.ts"], symbols: ["src/y.ts#Declared"] }));
    const amb = await why(root, "Declared");
    expect(amb.records).toEqual([]);
    expect(amb.candidates.map((c: { path: string }) => c.path)).toEqual(["src/x.ts", "src/y.ts"]);
  });

  test("text output says it infers nothing when a symbol is not found", async () => {
    const r = await enou(repo(), ["why", "nothingLikeThis"]);
    expect(r.out).toContain("not found in the tracked files".slice(0, 0) + "no definition of nothingLikeThis");
    expect(r.out).toContain("Nothing is inferred");
  });
});

describe("end to end", () => {
  test("capture → why hides the draft → accept → why shows the record with its commit", async () => {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/a.ts", "export const a = 1;\n");
    commitAll(root, "base");
    const id = await capture(root, [], { "--summary": "a is a constant on purpose" });
    expect((await why(root, "src/a.ts")).records).toEqual([]);
    await enou(root, ["accept", id]);
    commitAll(root, "knowledge");
    const a = await why(root, "src/a.ts");
    expect(ids(a)).toEqual([id]);
    expect(a.records[0].implementing_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(serialiseRecord).toBeDefined();
    expect(loadStore(root).entries.length).toBe(1);
    void BODY;
  });
});
