// The flat stores and draft writing (FR-041, FR-043, data-model §1, §3) — tasks.md T009, T017a.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serialiseRecord } from "../src/knowledge/record";
import { loadStore, writeDraft } from "../src/knowledge/store";
import { BODY, front, IDS, put, putRecord, tempRoot } from "./support/repo";

const listing = (root: string) =>
  ["records", "inbox"].flatMap((a) => readdirSync(join(root, ".knowledge", a)).map((f) => `${a}/${f}`)).sort();

describe("loadStore", () => {
  test("reads records and drafts once, each tagged with its area; missing directories are empty", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.b }));
    const s = loadStore(root);
    expect(s.entries.map((e) => [e.area, e.id])).toEqual([
      ["records", IDS.a],
      ["inbox", IDS.b],
    ]);
    expect(s.entries.every((e) => e.parsed.ok && e.parsed.issues.length === 0)).toBe(true);
    expect(loadStore(tempRoot(false)).entries).toEqual([]);
  });

  test("reports anything that is not a flat <ULID>.md file", () => {
    const root = tempRoot();
    put(root, ".knowledge/records/notes.md", "x");
    mkdirSync(join(root, ".knowledge/records/sub"));
    const s = loadStore(root);
    expect(s.strays.map((x) => x.path).sort()).toEqual([".knowledge/records/notes.md", ".knowledge/records/sub"]);
  });

  test("flags a file whose name and id disagree", () => {
    const root = tempRoot();
    put(root, `.knowledge/records/${IDS.b}.md`, serialiseRecord(front({ id: IDS.a }), BODY));
    const [e] = loadStore(root).entries;
    expect(e!.parsed.ok && e!.parsed.issues.map((i) => i.field)).toEqual(["id"]);
  });
});

describe("writeDraft", () => {
  test("writes canonical bytes to inbox/, never to records/", () => {
    const root = tempRoot();
    const r = writeDraft(loadStore(root), front(), BODY);
    expect(r).toEqual({ ok: true, id: IDS.a, path: `.knowledge/inbox/${IDS.a}.md` });
    expect(readFileSync(join(root, ".knowledge/inbox", `${IDS.a}.md`), "utf8")).toBe(serialiseRecord(front(), BODY));
    expect(listing(root)).toEqual([`inbox/${IDS.a}.md`]);
  });

  test("refuses an id already used in either store, and writes nothing", () => {
    for (const area of ["records", "inbox"] as const) {
      const root = tempRoot();
      putRecord(root, area, front({ id: IDS.a, summary: "the original" }));
      const before = listing(root);
      const r = writeDraft(loadStore(root), front({ id: IDS.a }), BODY);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.issues[0]!.field).toBe("id");
      expect(listing(root)).toEqual(before);
    }
  });

  test("supersedes must name a record — not a draft, not nothing", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    putRecord(root, "inbox", front({ id: IDS.b }));
    const s = loadStore(root);
    expect(writeDraft(s, front({ id: IDS.c, supersedes: IDS.a }), BODY).ok).toBe(true);
    const onDraft = writeDraft(s, front({ id: IDS.d, supersedes: IDS.b }), BODY);
    expect(!onDraft.ok && onDraft.issues[0]!.message).toContain("is a draft");
    const onNothing = writeDraft(loadStore(root), front({ id: IDS.d, supersedes: "01JBQ7K3M2N8P4R6T9V0W1X2YZ" }), BODY);
    expect(!onNothing.ok && onNothing.issues[0]!.message).toContain("no record");
  });

  test("a refusal at any stage leaves no file and no temporary file behind (T017a)", () => {
    const root = tempRoot();
    const lone = "x" + String.fromCharCode(0xdfff);
    for (const bad of [front({ summary: lone }), front({ paths: ["/etc/passwd"] }), front({ summary: "a\nb" })]) {
      const r = writeDraft(loadStore(root), bad, BODY);
      expect(r.ok).toBe(false);
    }
    const secret = writeDraft(loadStore(root), front(), "AKIA" + "IOSFODNN7" + "EXAMPLE");
    expect(secret.ok).toBe(false);
    expect(readdirSync(join(root, ".knowledge/inbox"))).toEqual([]);
  });
});
