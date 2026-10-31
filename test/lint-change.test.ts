// Lint against a change — US5 (tasks.md T062–T064, T067–T070a; FR-015, FR-016, FR-018, FR-034,
// FR-039, FR-045, FR-050; formats §3).

import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectChange, contradictions, lintChange, readTrailers } from "../src/knowledge/lint";
import { serialiseRecord } from "../src/knowledge/record";
import { loadStore } from "../src/knowledge/store";
import { buildTrust } from "../src/knowledge/trust";
import { capture, enou } from "./support/cli";
import { BODY, commitAll, front, gitInit, IDS, put, putRecord, sh, tempRoot } from "./support/repo";

const lint = async (root: string, args: string[] = []) => {
  const r = await enou(root, ["lint", ...args, "--json"]);
  return { code: r.code, ...JSON.parse(r.out) } as {
    code: number;
    findings: { check: string; path: string; field: string | null; message: string }[];
    uncovered: { module: string; records: number }[];
    unlinked_decisions: { ids: string[]; path: string }[];
    dangling_before: { id: string; ref: string }[];
    not_checked: string[];
    drafts: { id: string; paths: string[] }[];
  };
};
const checks = (r: { findings: { check: string }[] }) => r.findings.map((f) => f.check);
const rev = (root: string, r = "HEAD") => sh(root, "git", ["rev-parse", r]).trim();
const commit = (root: string, message: string) => {
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "--allow-empty", "-m", message]);
};

/** A repository with one declared module `src`, a base commit, and its sha. */
function repo(): { root: string; base: string } {
  const root = tempRoot();
  gitInit(root);
  put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n  - path: lib\n");
  put(root, "src/a.ts", "export function alpha() {}\n");
  put(root, "lib/b.ts", "export const beta = 1;\n");
  commitAll(root, "base");
  return { root, base: rev(root) };
}

describe("FR-015 — a module changed with no knowledge (range mode)", () => {
  test("is a finding naming the module and the commits; exit 2", async () => {
    const { root, base } = repo();
    put(root, "src/a.ts", "export function alpha() { return 1; }\n");
    commit(root, "change alpha");
    const r = await lint(root, ["--range", `${base}..HEAD`]);
    expect(r.code).toBe(2);
    expect(r.findings).toEqual([expect.objectContaining({ check: "unrecorded", path: "src" })]);
    expect(r.findings[0]!.message).toContain(rev(root).slice(0, 7));
  });

  test("names a draft that would cover it once accepted — a draft never clears the flag (FR-045)", async () => {
    const { root, base } = repo();
    put(root, "src/a.ts", "export function alpha() { return 2; }\n");
    const id = await capture(root, [], { "--paths": "src/a.ts" });
    commit(root, "change alpha, capture a draft");
    const r = await lint(root, ["--range", `${base}..HEAD`]);
    expect(checks(r)).toEqual(["unrecorded"]);
    expect(r.findings[0]!.message).toContain(`draft ${id} would cover it`);
  });

  test("clears when an accepted record covers the change, and when a Knowledge-None statement is added (T069)", async () => {
    const recorded = repo();
    put(recorded.root, "src/a.ts", "export function alpha() { return 3; }\n");
    await enou(recorded.root, ["accept", await capture(recorded.root, [], { "--paths": "src/a.ts" })]);
    commit(recorded.root, "change alpha with knowledge");
    expect(checks(await lint(recorded.root, ["--range", `${recorded.base}..HEAD`]))).toEqual([]);

    const declined = repo();
    put(declined.root, "src/a.ts", "export function alpha() { return 4; }\n");
    commit(declined.root, "change alpha");
    expect(checks(await lint(declined.root, ["--range", `${declined.base}..HEAD`]))).toEqual(["unrecorded"]);
    // Added afterwards, as its own commit: nothing is dismissed, the change now carries the statement.
    commit(declined.root, "say so\n\nKnowledge-None: renamed a local variable, nothing learned");
    expect(checks(await lint(declined.root, ["--range", `${declined.base}..HEAD`]))).toEqual([]);
  });

  test("a Knowledge-None on one commit covers the modules that commit touches, not other commits' modules", async () => {
    const { root, base } = repo();
    put(root, "src/a.ts", "export function alpha() { return 5; }\n");
    commit(root, "touch src");
    put(root, "lib/b.ts", "export const beta = 2;\n");
    commit(root, "touch lib\n\nKnowledge-None: constant bump");
    const r = await lint(root, ["--range", `${base}..HEAD`]);
    expect(r.findings.map((f) => f.path)).toEqual(["src"]);
  });

  test("a Knowledge-Record trailer counts only when it names an accepted record covering the module", async () => {
    const { root, base } = repo();
    const draft = await capture(root, [], { "--paths": "src/a.ts" });
    put(root, "src/a.ts", "export function alpha() { return 6; }\n");
    commit(root, `change\n\nKnowledge-Record: ${draft}`);
    expect(checks(await lint(root, ["--range", `${base}..HEAD`]))).toEqual(["unrecorded"]);
  });

  test("a commit carrying both trailers is reported, not resolved (T064)", async () => {
    const { root, base } = repo();
    put(root, "src/a.ts", "export function alpha() { return 7; }\n");
    commit(root, `both\n\nKnowledge-None: nothing\nKnowledge-Record: ${IDS.a}`);
    const r = await lint(root, ["--range", `${base}..HEAD`]);
    expect(checks(r)).toContain("trailers");
  });

  test("a Knowledge-None survives a squash merge that recomposes the message (T068, T067)", async () => {
    const { root, base } = repo();
    sh(root, "git", ["checkout", "-q", "-b", "feature"]);
    put(root, "src/a.ts", "export function alpha() { return 8; }\n");
    commit(root, "reformat");
    commit(root, "note\n\nKnowledge-None: formatting only");
    // The PR's own commits.
    expect(checks(await lint(root, ["--range", `${base}..feature`]))).toEqual([]);
    // After a squash merge, git's message indents every original message under the new one.
    sh(root, "git", ["checkout", "-q", "main"]);
    sh(root, "git", ["merge", "-q", "--squash", "feature"]);
    sh(root, "git", ["commit", "-q", "-F", join(root, ".git", "SQUASH_MSG")]);
    expect(readFileSync(join(root, ".git", "COMMIT_EDITMSG"), "utf8")).toContain("    Knowledge-None: formatting only");
    expect(checks(await lint(root, ["--range", `${base}..HEAD`]))).toEqual([]);
  });

  test("knowledge-only changes and undeclared paths raise nothing", async () => {
    const { root, base } = repo();
    put(root, "docs/notes.md", "anything\n");
    put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n  - path: lib\n  - path: tools\n");
    commit(root, "docs and declarations");
    expect(checks(await lint(root, ["--range", `${base}..HEAD`]))).toEqual([]);
  });

  test("is not judged without commits, and says so", async () => {
    const { root } = repo();
    put(root, "src/a.ts", "changed\n");
    for (const args of [[], ["--staged"]]) {
      const r = await lint(root, args);
      expect(checks(r)).toEqual([]);
      expect(r.not_checked.join(" ")).toContain("FR-015");
    }
  });
});

describe("readTrailers", () => {
  test("finds both trailers anywhere: trailer block, indented squash body, or a list item", () => {
    const t = readTrailers(`subject\n\n* first\n\n    Knowledge-None: one\n- Knowledge-Record: ${IDS.a}, ${IDS.b}\nknowledge-none: two`);
    expect(t.none).toEqual(["one", "two"]);
    expect(t.records).toEqual([IDS.a, IDS.b]);
  });
});

describe("--staged reads the index, not the working tree", () => {
  test("an edit to a record that is staged is caught; the same edit left unstaged is not", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    commitAll(root, "record");
    const file = join(root, `.knowledge/records/${IDS.a}.md`);
    writeFileSync(file, readFileSync(file, "utf8").replace("an unquoted", "a quietly edited"));
    expect(checks(await lint(root, ["--staged"]))).toEqual([]);
    sh(root, "git", ["add", file]);
    const r = await lint(root, ["--staged"]);
    expect(r.code).toBe(2);
    expect(checks(r)).toEqual(["immutable"]);
  });

  test("a broken file only in the working tree does not fail a clean staged commit", async () => {
    const { root } = repo();
    put(root, `.knowledge/records/${IDS.b}.md`, "not a record");
    expect(checks(await lint(root))).toEqual(["parse"]);
    expect(checks(await lint(root, ["--staged"]))).toEqual([]);
  });
});

describe("records must enter through accept", () => {
  test("a record placed in records/ by hand that capture would refuse is a finding", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, summary: "x".repeat(130), paths: ["src/a.ts"] }));
    const r = await lint(root);
    expect(r.findings).toContainEqual(expect.objectContaining({ check: "unaccepted", field: "summary" }));
  });

  test("a record that went through accept is not", async () => {
    const { root } = repo();
    await enou(root, ["accept", await capture(root, [], { "--paths": "src/a.ts" })]);
    expect(checks(await lint(root))).toEqual([]);
  });
});

describe("FR-016 — dangling references", () => {
  test("a rename is never a finding; a deletion the change makes is; an older dangling reference is information", async () => {
    const { root, base } = repo();
    put(root, "src/old.ts", "export const something = 'long enough to be a confident rename';\n");
    put(root, "src/gone.ts", "export const g = 1;\n");
    put(root, "src/long-gone.ts", "export const h = 1;\n");
    commit(root, "add files");
    sh(root, "git", ["rm", "-q", "src/long-gone.ts"]);
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/old.ts"] }));
    putRecord(root, "records", front({ id: IDS.b, paths: ["src/gone.ts"] }));
    putRecord(root, "records", front({ id: IDS.c, paths: ["src/long-gone.ts"] }));
    commit(root, "records\n\nKnowledge-None: setup");
    const mid = rev(root);
    sh(root, "git", ["mv", "src/old.ts", "src/new.ts"]);
    sh(root, "git", ["rm", "-q", "src/gone.ts"]);
    commit(root, "rename one, delete one\n\nKnowledge-None: cleanup");
    const r = await lint(root, ["--range", `${mid}..HEAD`]);
    expect(r.findings).toEqual([expect.objectContaining({ check: "dangling", path: `.knowledge/records/${IDS.b}.md`, field: "paths" })]);
    expect(r.dangling_before.map((d) => d.id)).toEqual([IDS.c]);
    void base;
  });

  test("a declared symbol whose definition the change removes is a finding", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"], symbols: ["src/a.ts#alpha"] }));
    commitAll(root, "record");
    put(root, "src/a.ts", "export function renamedAlpha() {}\n");
    const r = await lint(root);
    expect(r.findings).toContainEqual(expect.objectContaining({ check: "dangling", field: "symbols" }));
  });

  test("a superseded record's dangling path is not reported", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: IDS.b, paths: ["lib/b.ts"], supersedes: IDS.a }));
    commitAll(root, "records");
    rmSync(join(root, "src/a.ts"));
    expect(checks(await lint(root))).toEqual([]);
  });
});

describe("FR-018 — contradictions, mechanically", () => {
  test("a supersession fork with two current successors is a finding", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: IDS.b, paths: ["src/a.ts"], supersedes: IDS.a }));
    putRecord(root, "records", front({ id: IDS.c, paths: ["src/a.ts"], supersedes: IDS.a }));
    const r = await lint(root);
    expect(r.findings).toContainEqual(expect.objectContaining({ check: "contradiction", field: "supersedes" }));
  });

  test("a new decision on a path with another current decision is information, not a failure", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, kind: "decision", rejected: ["x"], paths: ["src/a.ts"] }));
    commitAll(root, "first decision");
    putRecord(root, "records", front({ id: IDS.b, kind: "decision", rejected: ["y"], paths: ["src/"] }));
    const r = await lint(root);
    expect(checks(r)).toEqual([]);
    expect(r.unlinked_decisions).toEqual([{ ids: [IDS.a, IDS.b], path: "src/a.ts" }]);
  });

  test("contradictions() is reusable with a path filter (for brief)", () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a, kind: "decision", rejected: ["x"], paths: ["src/a.ts"] }));
    putRecord(root, "records", front({ id: IDS.b, kind: "decision", rejected: ["y"], paths: ["src/a.ts"] }));
    const trust = buildTrust(loadStore(root));
    expect(contradictions(trust, { paths: ["src/a.ts"] })).toHaveLength(1);
    expect(contradictions(trust, { paths: ["lib/"] })).toHaveLength(0);
  });
});

describe("FR-039 — removing a declaration", () => {
  test("reports how many records it leaves in no module; a move does not", async () => {
    const { root } = repo();
    putRecord(root, "records", front({ id: IDS.a, paths: ["lib/b.ts"] }));
    commitAll(root, "record");
    put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n");
    const removed = await lint(root);
    expect(removed.uncovered).toEqual([{ module: "lib", records: 1 }]);
    expect(removed.code).toBe(0);
    put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n  - path: library\n    formerly: [lib]\n");
    expect((await lint(root)).uncovered).toEqual([]);
  });
});

describe("FR-034 — every edit to a recorded file other than a conforming redaction is rejected (T070, SC-012)", () => {
  test("k/N over a set of edits", async () => {
    const edits: [string, (text: string) => string | null][] = [
      ["summary", (t) => t.replace("an unquoted short SHA", "a bare short SHA")],
      ["body", (t) => t.replace("Quote every", "Always quote every")],
      ["paths", (t) => t.replace('"src/a.ts"', '"src/other.ts"')],
      ["kind", (t) => t.replace('kind: "gotcha"', 'kind: "invariant"')],
      ["added field", (t) => t.replace('kind: "gotcha"', 'kind: "gotcha"\nspec: "specs/x.md"')],
      ["provenance", (t) => t.replace('"2026-10-31"', '"2026-10-30"')],
      ["deleted", () => null],
      [
        "redaction listing the wrong field",
        (t) => t.replace('summary: "an unquoted short SHA can parse as a number"', 'summary: "[redacted]"').replace("\n---\n\n", '\nredaction:\n  date: "2026-10-31"\n  reason: "r"\n  fields:\n    - "body"\n---\n\n'),
      ],
    ];
    let rejected = 0;
    for (const [, edit] of edits) {
      const { root } = repo();
      const rel = putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
      commitAll(root, "record");
      const file = join(root, rel);
      const next = edit(readFileSync(file, "utf8"));
      if (next === null) rmSync(file);
      else writeFileSync(file, next);
      if (checks(await lint(root)).includes("immutable")) rejected++;
    }
    expect(`${rejected}/${edits.length}`).toBe(`${edits.length}/${edits.length}`);

    const { root } = repo();
    const rel = putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    commitAll(root, "record");
    const redacted = serialiseRecord(
      front({ id: IDS.a, paths: ["src/a.ts"], summary: "[redacted]", redaction: { date: "2026-10-31", reason: "r", fields: ["summary"] } }),
      BODY,
    );
    writeFileSync(join(root, rel), redacted);
    expect(checks(await lint(root))).toEqual([]);
  });
});

describe("cost follows the change, not the store (T070a)", () => {
  test("lint over 2N records takes less than three times as long as over N, in the same run", () => {
    const N = 300;
    const build = (n: number) => {
      const { root } = repo();
      const ids = Array.from({ length: n }, (_, i) => `01JBQ7K3M2N8P4R6T9V${String(i).padStart(7, "0").replace(/[ILOU]/g, "0")}`);
      for (const id of ids) putRecord(root, "records", front({ id, paths: ["src/a.ts"] }));
      commitAll(root, "records");
      put(root, "src/a.ts", "changed\n");
      return root;
    };
    const time = (root: string) => {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const c = collectChange(root, { kind: "worktree" });
        if (typeof c === "string") throw new Error(c);
        const t0 = performance.now();
        lintChange(root, c);
        samples.push(performance.now() - t0);
        c.cleanup();
      }
      return samples.sort((a, b) => a - b)[1]!;
    };
    const small = build(N);
    const large = build(2 * N);
    time(small); // warm-up
    const ratio = time(large) / time(small);
    expect(ratio).toBeLessThan(3);
  });
});

describe("information, never failure", () => {
  test("drafts waiting are listed with their paths (FR-050) and never set exit 2", async () => {
    const { root } = repo();
    const id = await capture(root, [], { "--paths": "lib/b.ts" });
    const r = await lint(root);
    expect(r.code).toBe(0);
    expect(r.drafts).toEqual([{ id, paths: ["lib/b.ts"] }]);
  });
});
