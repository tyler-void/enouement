// The record format and canonical writer (data-model §2.1, §2.8, §3) — tasks.md T013, T014, T015,
// T017a; plan.md binding tests #5, #5a, #6.

import { describe, expect, test } from "bun:test";
import { parseYaml } from "../src/knowledge/platform";
import {
  canonicalIssue,
  checkRepoPath,
  parseRecordText,
  parseSymbol,
  prepareRecord,
  serialiseRecord,
  validateRecord,
} from "../src/knowledge/record";
import { BODY, front, IDS } from "./support/repo";

const FULL = front({
  kind: "decision",
  summary: "#42 fixed: why this: matters",
  provenance: { origin: "backfilled", source: "commit 5ba3651 and its PR", date: "2026-09-21" },
  paths: ["src/server.ts", "src/backends/"],
  symbols: ["src/knowledge/record.ts#serialiseRecord"],
  spec: "specs/001-continuous-project-knowledge/spec.md",
  commits: ["b4563b3"],
  supersedes: IDS.b,
  rejected: ["keep the gateway and re-measure it", 'say "yes": no'],
});

function frontMatterLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.slice(1, lines.indexOf("---", 1));
}

describe("canonical writer", () => {
  test("double-quotes every string scalar (plan #5)", () => {
    const text = serialiseRecord(FULL, BODY);
    for (const line of frontMatterLines(text)) {
      const m = /^\s*(?:- |[A-Za-z_][\w-]*: )(.*)$/.exec(line);
      if (!m) continue; // a key that opens a nested block
      expect(m[1]!.startsWith('"')).toBe(true);
    }
  });

  test("parse → re-serialise is byte-identical (plan #5)", () => {
    const text = serialiseRecord(FULL, BODY);
    const parsed = parseRecordText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serialiseRecord(parsed.data, parsed.body)).toBe(text);
    expect(canonicalIssue(text)).toBeNull();
  });

  test("writes known keys in a fixed order and unknown keys after them, preserved and sorted", () => {
    const data = { zeta: "z", ...FULL, alpha: { b: "2", a: ["1", { y: "y", x: "x" }] } };
    const text = serialiseRecord(data, BODY);
    const keys = frontMatterLines(text).filter((l) => /^\S/.test(l)).map((l) => l.split(":")[0]);
    expect(keys).toEqual([
      "id", "kind", "summary", "provenance", "paths", "symbols", "spec", "commits", "supersedes", "rejected",
      "alpha", "zeta",
    ]);
    const back = parseRecordText(text);
    expect(back.ok && back.data.alpha).toEqual({ a: ["1", { x: "x", y: "y" }], b: "2" });
    expect(back.ok && serialiseRecord(back.data, back.body)).toBe(text);
  });

  test("never writes a byte-order mark or a CR, and ends with one newline", () => {
    const text = serialiseRecord(FULL, "line one\r\nline two\r\n\r\n");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.includes("\r")).toBe(false);
    expect(text.endsWith("line two\n")).toBe(true);
  });

  test("escapes invisible and line-separating characters instead of writing them raw", () => {
    const odd = ["a", 0x2028, "b", 0x00ad, "c", 0x7f, "d"].map((x) => (typeof x === "number" ? String.fromCharCode(x) : x)).join("");
    const text = serialiseRecord(front({ summary: odd }), BODY);
    expect(/[\u007f-\u009f\u00ad\u2028\u2029\ufeff]/.test(text)).toBe(false);
    const back = parseRecordText(text);
    expect(back.ok && back.data.summary).toBe(odd);
  });
});

describe("short SHAs and other YAML scalar hazards (plan #5a)", () => {
  const SHAS = ["0123456", "6e40653", "9e99999", "0e12345", "b4563b3"];

  test("unquoted, the parser destroys them — the reason every string is quoted", () => {
    expect((parseYaml("c: 0123456\n") as { c: unknown }).c).toBe(123456);
    expect((parseYaml("c: 6e40653\n") as { c: unknown }).c).toBe(Infinity);
    expect((parseYaml("s: #42 fixed\n") as { s: unknown }).s).toBeNull();
  });

  test("all-digit and exponent-form SHAs round-trip as strings", () => {
    const data = front({ provenance: { origin: "backfilled", source: "history", date: "2026-09-21" }, commits: SHAS });
    const text = serialiseRecord(data, BODY);
    const back = parseRecordText(text);
    expect(back.ok && back.data.commits).toEqual(SHAS);
    expect(back.ok && serialiseRecord(back.data, back.body)).toBe(text);
  });

  test("exponent and number-like strings round-trip in free-text fields too", () => {
    const words = ["1e10", "0e12345", "0755", ".inf", "-.nan", "true", "no", "~", "null", "2026-10-31", "12:30"];
    const data = front({ kind: "decision", rejected: words });
    const back = parseRecordText(serialiseRecord(data, BODY));
    expect(back.ok && back.data.rejected).toEqual(words);
  });
});

describe("type validation never coerces (plan #6)", () => {
  function parsedFrom(frontMatter: string) {
    const p = parseRecordText(`---\n${frontMatter}---\n\n${BODY}\n`);
    if (!p.ok) throw new Error("fixture did not parse");
    return p;
  }
  const base =
    `id: "${IDS.a}"\nkind: "gotcha"\nsummary: "s"\npaths:\n  - "src/a.ts"\n` +
    `provenance:\n  origin: "backfilled"\n  source: "history"\n`;

  test("a commit written unquoted is rejected with a hint to quote it", () => {
    for (const sha of ["6e40653", "0123456"]) {
      const p = parsedFrom(`${base}  date: "2026-09-21"\ncommits:\n  - ${sha}\n`);
      const issues = validateRecord(p.data, p.body);
      expect(issues).toContainEqual({ field: "commits[0]", message: expect.stringContaining("double-quoted") });
      expect(typeof (p.data.commits as unknown[])[0]).toBe("number");
    }
  });

  test("a date that is not a real YYYY-MM-DD string is rejected", () => {
    for (const date of ['"2026-13-01"', '"2026-02-30"', '"31/10/2026"', "20261031"]) {
      const p = parsedFrom(`${base}  date: ${date}\n`);
      expect(validateRecord(p.data, p.body).map((i) => i.field)).toContain("provenance.date");
    }
  });

  test("validation does not modify what it validates", () => {
    const p = parsedFrom(`${base}  date: "2026-09-21"\ncommits:\n  - 0123456\n`);
    const before = JSON.stringify(p.data);
    validateRecord(p.data, p.body);
    expect(JSON.stringify(p.data)).toBe(before);
  });
});

describe("validation rules", () => {
  const fields = (data: Record<string, unknown>, body = BODY, max?: number) =>
    validateRecord(data, body, { maxSummary: max }).map((i) => i.field);

  test("a valid record has no issues", () => {
    expect(validateRecord(front(), BODY)).toEqual([]);
    expect(validateRecord(FULL, BODY)).toEqual([]);
  });

  test("a decision must name a rejected alternative; other kinds need not", () => {
    expect(fields(front({ kind: "decision" }))).toContain("rejected");
    expect(fields(front({ kind: "decision", rejected: [] }))).toContain("rejected");
    expect(fields(front({ kind: "invariant" }))).toEqual([]);
  });

  test("a summary is one line, within the cap, never trimmed for you", () => {
    expect(fields(front({ summary: "one\ntwo" }))).toContain("summary");
    expect(fields(front({ summary: " padded" }))).toContain("summary");
    expect(fields(front({ summary: "x".repeat(121) }), BODY, 120)).toContain("summary");
    expect(fields(front({ summary: "x".repeat(120) }), BODY, 120)).toEqual([]);
    expect(fields(front({ summary: "x".repeat(500) }))).toEqual([]); // no cap at read time
  });

  test("backfilled and oral records name their source; commits are stored only when backfilled", () => {
    expect(fields(front({ provenance: { origin: "oral", date: "2026-10-31" } }))).toContain("provenance.source");
    expect(fields(front({ commits: ["b4563b3"] }))).toContain("commits");
  });

  test("a record needs a body, a kind from the list, and an id that is a ULID", () => {
    expect(fields(front(), "   \n")).toContain("body");
    expect(fields(front({ kind: "note" }))).toContain("kind");
    expect(fields(front({ id: "kr-1" }))).toContain("id");
    expect(fields(front({ supersedes: IDS.a }))).toContain("supersedes");
  });
});

describe("paths and symbols are refused, never repaired (T017a)", () => {
  test("checkRepoPath", () => {
    expect(checkRepoPath("src/a.ts")).toBeNull();
    expect(checkRepoPath("src/backends/")).toBeNull();
    expect(checkRepoPath("src/**/*.ts")).toBeNull();
    for (const bad of ["", " src", "/etc/passwd", "C:/x", "src\\a.ts", "./src", "src//a", "src/../etc", "a/./b"])
      expect(checkRepoPath(bad)).not.toBeNull();
    expect(checkRepoPath("src/*.ts", { glob: false })).not.toBeNull();
  });

  test("parseSymbol", () => {
    expect(parseSymbol("src/util/context.ts#findContextPacks")).toEqual({ path: "src/util/context.ts", name: "findContextPacks" });
    for (const bad of ["findContextPacks", "#x", "src/a.ts#", "src/*.ts#x", "src/dir/#x", "src/a.ts#not a name"])
      expect(typeof parseSymbol(bad)).toBe("string");
  });

  test("bad paths and symbols come back as field-level issues", () => {
    const issues = validateRecord(front({ paths: ["src/../etc"], symbols: ["Foo"] }), BODY);
    expect(issues.map((i) => i.field)).toEqual(["paths[0]", "symbols[0]"]);
  });
});

describe("prepareRecord: what must hold before bytes are written", () => {
  test("refuses a value that validates but would not read back — a lone surrogate (T017a)", () => {
    const lone = "x" + String.fromCharCode(0xd800) + "y";
    expect(validateRecord(front({ summary: lone }), BODY)).toEqual([]);
    const r = prepareRecord(front({ summary: lone }), BODY);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]!.message).toContain("does not read back identically");
  });

  test("refuses a secret, naming the field and the pattern but never echoing the secret", () => {
    const key = "AKIA" + "IOSFODNN7" + "EXAMPLE";
    const r = prepareRecord(front(), `The deploy used ${key} once.`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]!.field).toBe("body");
    expect(r.issues[0]!.message).toContain("aws-access-key-id");
    expect(r.issues[0]!.message).not.toContain(key);
  });

  test("returns canonical text for a good record", () => {
    const r = prepareRecord(FULL, BODY);
    expect(r.ok && r.text).toBe(serialiseRecord(FULL, BODY));
  });
});

describe("canonicalIssue: what lint reports", () => {
  const text = serialiseRecord(FULL, BODY);
  test("names a byte-order mark, CR line endings, and reordered keys", () => {
    expect(canonicalIssue(String.fromCharCode(0xfeff) + text)!.message).toContain("byte-order mark");
    expect(canonicalIssue(text.replace(/\n/g, "\r\n"))!.message).toContain("CR line endings");
    const swapped = text.replace(/^(id: .*)\n(kind: .*)$/m, "$2\n$1");
    expect(swapped).not.toBe(text);
    expect(canonicalIssue(swapped)!.message).toContain("not in canonical form");
  });

  test("parse failures are reported as such, not as canonical-form issues", () => {
    expect(parseRecordText("no front matter").ok).toBe(false);
    expect(parseRecordText("---\nid: [unclosed\n---\n").ok).toBe(false);
    expect(parseRecordText("---\n- a list\n---\nbody\n").ok).toBe(false);
    expect(parseRecordText("---\nid: \"x\"\n").ok).toBe(false);
  });
});
