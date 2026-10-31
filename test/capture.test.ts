// Capture, acceptance, rejection, redaction and the recall stub — US1 (tasks.md T020–T024, T027–
// T032c; plan.md binding tests #1, #3, #15, #16).

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lintStore, gitBase } from "../src/knowledge/lint";
import { loadStore } from "../src/knowledge/store";
import { implementingCommit } from "../src/knowledge/why";
import { capture, enou } from "./support/cli";
import { commitAll, gitInit, put, sh, tempRoot } from "./support/repo";

const inbox = (root: string) => readdirSync(join(root, ".knowledge/inbox")).filter((f) => f.endsWith(".md"));
const records = (root: string) => readdirSync(join(root, ".knowledge/records")).filter((f) => f.endsWith(".md"));
const head = (root: string) => sh(root, "git", ["rev-parse", "HEAD"]).trim();

describe("enou record — writes a draft, never a record (T020, T029)", () => {
  test("a capture lands in inbox/ with today's date, contemporaneous provenance and its id returned", async () => {
    const root = tempRoot();
    const id = await capture(root);
    expect(inbox(root)).toEqual([`${id}.md`]);
    expect(records(root)).toEqual([]);
    const text = readFileSync(join(root, `.knowledge/inbox/${id}.md`), "utf8");
    expect(text).toContain('origin: "contemporaneous"');
  });

  test("paths are taken relative to the current directory and stored repository-relative", async () => {
    const root = tempRoot();
    put(root, "src/util/x.ts", "");
    const id = await capture(join(root, "src"), [], { "--paths": "util/x.ts,util/" });
    const r = await enou(root, ["why", "src/util/x.ts", "--include-drafts", "--json"]);
    expect(JSON.parse(r.out).drafts[0].paths).toEqual(["src/util/x.ts", "src/util/"]);
    expect(JSON.parse(r.out).drafts[0].id).toBe(id);
  });

  test("the body can come from a file or stdin", async () => {
    const root = tempRoot();
    put(root, "notes.md", "From a file.");
    const fromFile = await enou(root, ["record", "--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts", "--body-file", "notes.md"]);
    expect(fromFile.code).toBe(0);
    const fromStdin = await enou(root, ["record", "--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts", "--body-file", "-"], { stdin: "From stdin." });
    expect(fromStdin.code).toBe(0);
  });

  test("refuses, writing nothing: missing/over-long summary, decision without rejected, unknown supersedes, missing source", async () => {
    const root = tempRoot();
    const cases: string[][] = [
      ["--kind", "gotcha", "--summary", "x".repeat(121), "--paths", "src/a.ts", "--body", "b"],
      ["--kind", "decision", "--summary", "s", "--paths", "src/a.ts", "--body", "b"],
      ["--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts", "--body", "b", "--supersedes", "01JBQ7K3M2N8P4R6T9V0W1X2Y3"],
      ["--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts", "--body", "b", "--provenance", "oral"],
      ["--kind", "gotcha", "--summary", "s", "--paths", "/etc/passwd", "--body", "b"],
      ["--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts"],
    ];
    for (const c of cases) {
      const r = await enou(root, ["record", ...c]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("refused");
    }
    const noSummary = await enou(root, ["record", "--kind", "gotcha", "--paths", "src/a.ts", "--body", "b"]);
    expect(noSummary.code).toBe(1);
    expect(inbox(root)).toEqual([]);
  });

  test("a module's summary cap applies to records about it", async () => {
    const root = tempRoot();
    put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n    view: { max_summary: 10 }\n");
    const r = await enou(root, ["record", "--kind", "gotcha", "--summary", "eleven char", "--paths", "src/a.ts", "--body", "b"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("limit is 10");
  });

  test("a seeded corpus of secret shapes is refused at capture, the match reported (T030, SC-012)", async () => {
    const root = tempRoot();
    const shapes = [
      ["-----BEGIN ", "OPENSSH PRIVATE", " KEY-----"],
      ["AKIA", "IOSFODNN7", "EXAMPLE"],
      ["gh", "p_", "a1B2c3D4".repeat(5)],
      ["xo", "xb-", "1234567890-abcdefghij"],
      ["Authorization: Bearer ", "eyJhbGciOiJI", "UzI1NiJ9abcdef"],
      ["DB_PASSWORD=", "hunter2hunter2hunter2"],
    ].map((p) => p.join(""));
    let refused = 0;
    for (const s of shapes) {
      const r = await enou(root, ["record", "--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts", "--body", `see ${s}`]);
      if (r.code === 1 && r.err.includes("secret pattern")) refused++;
    }
    expect(refused).toBe(shapes.length);
    expect(inbox(root)).toEqual([]);
  });
});

describe("enou drafts / accept / reject (T020a)", () => {
  test("accept moves a draft to records/ canonically, under the same id; reject deletes a draft", async () => {
    const root = tempRoot();
    const a = await capture(root, [], { "--summary": "first" });
    const b = await capture(root, [], { "--summary": "second" });
    expect((await enou(root, ["drafts"])).out).toContain("2 drafts waiting");
    expect((await enou(root, ["accept", a])).code).toBe(0);
    expect((await enou(root, ["reject", b])).code).toBe(0);
    expect(records(root)).toEqual([`${a}.md`]);
    expect(inbox(root)).toEqual([]);
    expect(lintStore(loadStore(root)).findings).toEqual([]);
  });

  test("accepting a hand-edited draft re-validates it and writes canonical bytes", async () => {
    const root = tempRoot();
    const id = await capture(root);
    const file = join(root, `.knowledge/inbox/${id}.md`);
    writeFileSync(file, readFileSync(file, "utf8").replace('summary: "a short summary"', "summary: edited by hand"));
    expect((await enou(root, ["accept", id])).code).toBe(0);
    expect(readFileSync(join(root, `.knowledge/records/${id}.md`), "utf8")).toContain('summary: "edited by hand"');
  });

  test("a secret pasted into a draft after capture is refused at accept, and records/ is unchanged (plan #15)", async () => {
    const root = tempRoot();
    const id = await capture(root);
    const file = join(root, `.knowledge/inbox/${id}.md`);
    writeFileSync(file, readFileSync(file, "utf8") + "\nThe key was " + ["AKIA", "IOSFODNN7", "EXAMPLE"].join("") + "\n");
    const r = await enou(root, ["accept", id]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("aws-access-key-id");
    expect(records(root)).toEqual([]);
    expect(inbox(root)).toEqual([`${id}.md`]);
  });

  test("ids are taken in order; the first refusal stops the run and says what was done", async () => {
    const root = tempRoot();
    const a = await capture(root);
    const r = await enou(root, ["accept", a, "01JBQ7K3M2N8P4R6T9V0W1X2Y3"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`accepted ${a}`);
    expect(r.err).toContain("not a draft");
  });

  test("a draft superseding a draft is refused; a fork of a supersession chain is refused (FR-046a, T032c)", async () => {
    const root = tempRoot();
    const a = await capture(root, [], { "--summary": "original" });
    await enou(root, ["accept", a]);
    const b = await capture(root, ["--supersedes", a], { "--summary": "replacement one" });
    const c = await capture(root, ["--supersedes", a], { "--summary": "replacement two" });
    expect((await enou(root, ["accept", b])).code).toBe(0);
    const fork = await enou(root, ["accept", c]);
    expect(fork.code).toBe(1);
    expect(fork.err).toContain(`${b} already supersedes`);
  });

  test("records are never rejected; reject never touches records/", async () => {
    const root = tempRoot();
    const a = await capture(root);
    await enou(root, ["accept", a]);
    const r = await enou(root, ["reject", a]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("never rejected");
    expect(records(root)).toEqual([`${a}.md`]);
  });
});

describe("implementing commit is derived, never stored (T022, T031, T032b; plan #3, #16)", () => {
  async function setup() {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/a.ts", "export const a = 1;\n");
    commitAll(root, "base");
    return root;
  }

  test("a draft committed, then accepted later: the capture commit, not the acceptance commit", async () => {
    const root = await setup();
    const id = await capture(root);
    commitAll(root, "capture");
    const captureSha = head(root);
    await enou(root, ["accept", id]);
    commitAll(root, "accept");
    expect(implementingCommit(root, id)).toBe(captureSha);
  });

  test("a draft never committed: the commit that brought the accepted record", async () => {
    const root = await setup();
    const id = await capture(root);
    await enou(root, ["accept", id]);
    commitAll(root, "capture and accept");
    expect(implementingCommit(root, id)).toBe(head(root));
  });

  test("still resolves after an amend, a rebase and a squash merge", async () => {
    const root = await setup();
    sh(root, "git", ["checkout", "-q", "-b", "feature"]);
    const id = await capture(root);
    commitAll(root, "capture");
    sh(root, "git", ["commit", "-q", "--amend", "-m", "capture, amended"]);
    expect(implementingCommit(root, id)).toBe(head(root));

    sh(root, "git", ["checkout", "-q", "main"]);
    put(root, "src/b.ts", "export const b = 2;\n");
    commitAll(root, "main moves on");
    sh(root, "git", ["checkout", "-q", "feature"]);
    sh(root, "git", ["rebase", "-q", "main"]);
    expect(implementingCommit(root, id)).toBe(head(root));

    await enou(root, ["accept", id]);
    commitAll(root, "accept");
    sh(root, "git", ["checkout", "-q", "main"]);
    sh(root, "git", ["merge", "-q", "--squash", "feature"]);
    sh(root, "git", ["commit", "-q", "-m", "squashed feature"]);
    expect(implementingCommit(root, id)).toBe(head(root));
  });
});

describe("enou redact (T024)", () => {
  test("replaces the named fields, records {date, reason, fields}, warns about history and rotation, and lint accepts it", async () => {
    const root = tempRoot();
    gitInit(root);
    const id = await capture(root, [], { "--summary": "deploy needs the staging token" });
    await enou(root, ["accept", id]);
    commitAll(root, "record");
    const r = await enou(root, ["redact", id, "--reason", "named an internal host", "--fields", "summary,body"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("still exists in git history");
    const text = readFileSync(join(root, `.knowledge/records/${id}.md`), "utf8");
    expect(text).toContain('summary: "[redacted]"');
    expect(text).toContain('reason: "named an internal host"');
    expect(lintStore(loadStore(root), gitBase(root)).findings).toEqual([]);
  });

  test("refuses drafts, unknown fields, a missing reason, and a second redaction", async () => {
    const root = tempRoot();
    const draft = await capture(root);
    expect((await enou(root, ["redact", draft, "--reason", "r", "--fields", "summary"])).err).toContain("is a draft");
    await enou(root, ["accept", draft]);
    expect((await enou(root, ["redact", draft, "--reason", "r", "--fields", "paths"])).code).toBe(1);
    expect((await enou(root, ["redact", draft, "--reason", " ", "--fields", "summary"])).code).toBe(1);
    expect((await enou(root, ["redact", draft, "--reason", "r", "--fields", "summary"])).code).toBe(0);
    expect((await enou(root, ["redact", draft, "--reason", "again", "--fields", "body"])).err).toContain("already redacted");
  });
});

describe("enou recall — a stub that refuses (T027, T028; plan #1)", () => {
  test("exits 1, says not implemented, returns no results", async () => {
    const root = tempRoot();
    await enou(root, ["accept", await capture(root, [], { "--summary": "something recall would find" })]);
    const r = await enou(root, ["recall", "something", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ results: [] });
    expect(JSON.parse(r.out).error).toContain("not implemented");
  });
});

describe("enou modules (T023)", () => {
  test("add, list, move keeps formerly, remove reports un-covered records, uncovered lists tracked gaps", async () => {
    const root = tempRoot();
    gitInit(root);
    put(root, "src/a.ts", "");
    put(root, "docs/x.md", "");
    commitAll(root, "base");
    expect((await enou(root, ["modules", "add", "src"])).code).toBe(0);
    expect((await enou(root, ["modules", "uncovered"])).out).toBe("docs/");
    await enou(root, ["accept", await capture(root)]);
    expect((await enou(root, ["modules", "list"])).out).toContain("src  1 record");
    const moved = await enou(root, ["modules", "move", "src", "lib"]);
    expect(moved.out).toContain("kept as formerly");
    expect(readFileSync(join(root, ".knowledge/modules.yaml"), "utf8")).toContain('formerly: ["src"]');
    const removed = await enou(root, ["modules", "remove", "lib"]);
    expect(removed.out).toContain("1 of its 1 record now belong to no module");
    expect(existsSync(join(root, ".knowledge/modules.yaml"))).toBe(true);
  });
});
