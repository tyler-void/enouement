// The current-truth view and the full log — US3 (tasks.md T043–T045, T052–T054, T053a; SC-011).

import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseModules } from "../src/knowledge/modules";
import { loadStore } from "../src/knowledge/store";
import { buildTrust } from "../src/knowledge/trust";
import { findModule, moduleView, renderView } from "../src/knowledge/view";
import { enou } from "./support/cli";
import { front, put, putRecord, tempRoot } from "./support/repo";

// Ids in creation order: ids[0] < ids[1] < …
const ids = Array.from({ length: 30 }, (_, i) => `01JBQ7K3M2N8P4R6T9V0W1X${"ABCDEFGHJKMNPQRSTVWXYZ0123456789"[i]}AA`).sort();

function repo(modulesYaml = "modules:\n  - path: src\n") {
  const root = tempRoot();
  put(root, ".knowledge/modules.yaml", modulesYaml);
  return root;
}

const view = (root: string, mod = "src") => {
  const m = parseModules(readFileSync(`${root}/.knowledge/modules.yaml`, "utf8"));
  if (!m.ok) throw new Error("modules");
  return moduleView(buildTrust(loadStore(root)), m.config, findModule(m.config, mod)!);
};

describe("moduleView", () => {
  test("kind priority outranks recency: last year's invariant sits above today's decision (T053)", () => {
    const root = repo();
    putRecord(root, "records", front({ id: ids[0], kind: "invariant", summary: "old invariant", paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: ids[1], kind: "decision", rejected: ["x"], summary: "new decision", paths: ["src/a.ts"] }));
    expect(view(root).shown.map((e) => e.summary)).toEqual(["old invariant", "new decision"]);
  });

  test("within a kind, newest first; grouped by kind; no heading for an absent kind", () => {
    const root = repo();
    putRecord(root, "records", front({ id: ids[0], kind: "gotcha", summary: "g old", paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: ids[1], kind: "gotcha", summary: "g new", paths: ["src/b.ts"] }));
    putRecord(root, "records", front({ id: ids[2], kind: "invariant", summary: "inv", paths: ["src/c.ts"] }));
    const text = renderView(view(root));
    expect(text).toBe(
      ["src — current truth", "invariant", `  ${ids[2]}  inv`, "gotcha", `  ${ids[1]}  g new`, `  ${ids[0]}  g old`].join("\n"),
    );
  });

  test("over the limit: top N survive and an overflow line names the log; under it, no overflow line (T054)", () => {
    const root = repo("modules:\n  - path: src\n    view: { max_records: 3 }\n");
    for (let i = 0; i < 5; i++) putRecord(root, "records", front({ id: ids[i], summary: `s${i}`, paths: ["src/a.ts"] }));
    const v = view(root);
    expect(v.shown.map((e) => e.summary)).toEqual(["s4", "s3", "s2"]);
    expect(v.omitted).toBe(2);
    expect(renderView(v)).toContain("… 2 more current records not shown — full log: enou log src");
    const small = repo();
    putRecord(small, "records", front({ id: ids[0], paths: ["src/a.ts"] }));
    expect(renderView(view(small))).not.toContain("more current record");
  });

  test("a superseded record is not in the view; its successor is; a redacted one keeps its place (T053a, FR-027d)", () => {
    const root = repo();
    putRecord(root, "records", front({ id: ids[0], kind: "invariant", summary: "old rule", paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: ids[1], kind: "invariant", summary: "new rule", supersedes: ids[0], paths: ["src/a.ts"] }));
    putRecord(root, "records", front({
      id: ids[2], summary: "[redacted]", paths: ["src/a.ts"],
      redaction: { date: "2026-10-31", reason: "r", fields: ["summary"] },
    }));
    const text = renderView(view(root));
    expect(text).not.toContain("old rule");
    expect(text).toContain("new rule");
    expect(text).toContain(`${ids[2]}  [redacted]`);
  });

  test("every record superseded with nothing current says so; no records at all renders nothing (T055)", () => {
    const root = repo();
    expect(renderView(view(root))).toBe("");
    putRecord(root, "records", front({ id: ids[0], paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: ids[1], paths: ["elsewhere/x.ts"], supersedes: ids[0] }));
    expect(renderView(view(root))).toContain("no current truth recorded");
  });

  test("membership is computed from declarations, formerly included (FR-041)", () => {
    const root = repo("modules:\n  - path: lib\n    formerly: [src]\n");
    putRecord(root, "records", front({ id: ids[0], summary: "from before the rename", paths: ["src/a.ts"] }));
    expect(view(root, "lib").shown.map((e) => e.summary)).toEqual(["from before the rename"]);
  });

  test("drafts are never in the view; with --include-drafts they are listed apart and not counted", async () => {
    const root = repo("modules:\n  - path: src\n    view: { max_records: 1 }\n");
    putRecord(root, "records", front({ id: ids[0], paths: ["src/a.ts"] }));
    putRecord(root, "inbox", front({ id: ids[1], summary: "a draft", paths: ["src/a.ts"] }));
    expect((await enou(root, ["view", "src"])).out).not.toContain("a draft");
    const withDrafts = (await enou(root, ["view", "src", "--include-drafts"])).out;
    expect(withDrafts).toContain("NOT knowledge");
    expect(withDrafts).not.toContain("more current record");
  });

  test("byte-identical across renders of unchanged records, for every module (T052, SC-011)", async () => {
    const root = repo("modules:\n  - path: src\n  - path: lib\n");
    for (let i = 0; i < 12; i++)
      putRecord(root, "records", front({ id: ids[i], kind: ["invariant", "gotcha", "convention"][i % 3], summary: `s${i}`, paths: [i % 2 ? "src/a.ts" : "lib/b.ts"] }));
    for (const m of ["src", "lib"]) {
      const a = await enou(root, ["view", m]);
      const b = await enou(root, ["view", m]);
      expect(a.out).toBe(b.out);
      expect(a.out.length).toBeGreaterThan(0);
    }
  });
});

describe("enou view / enou log", () => {
  test("the log shows every record, superseded ones marked, oldest first; neither command writes a file", async () => {
    const root = repo();
    putRecord(root, "records", front({ id: ids[0], summary: "first", paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: ids[1], summary: "second", paths: ["src/a.ts"], supersedes: ids[0] }));
    const before = execSync(`find ${root} -type f | sort`).toString();
    const log = await enou(root, ["log", "src"]);
    expect(log.out).toContain(`[superseded by ${ids[1]}]`);
    expect(log.out.indexOf("first")).toBeLessThan(log.out.indexOf("second"));
    await enou(root, ["view", "src"]);
    expect(execSync(`find ${root} -type f | sort`).toString()).toBe(before);
  });

  test("an undeclared module is refused, naming the declared ones", async () => {
    const r = await enou(repo(), ["view", "nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Declared: src");
  });
});
