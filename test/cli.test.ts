// The command surface's plumbing — one definition per command (T004a), root discovery (T004b),
// exit codes (T004c) — and `enou lint` end to end.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argKey, parseArgs, usage, type CommandDef } from "../src/cli/commands";
import { main, type Io } from "../src/cli/main";
import { findRoot, toRepoPath } from "../src/cli/root";
import { front, gitInit, IDS, put, putRecord, tempRoot } from "./support/repo";

const DEF: CommandDef = {
  name: "demo",
  summary: "A command used only by these tests.",
  positionals: [
    { name: "first", description: "required", required: true },
    { name: "rest", description: "the rest", variadic: true },
  ],
  options: [
    { name: "kind", type: "enum", values: ["a", "b"], description: "an enum" },
    { name: "limit", type: "integer", min: 1, max: 100, description: "a range" },
    { name: "paths", type: "string", commaList: true, description: "comma list" },
    { name: "commit", type: "string", repeatable: true, description: "repeatable" },
    { name: "include-drafts", type: "boolean", description: "a flag" },
    { name: "summary", type: "string", description: "plain" },
  ],
};

describe("parseArgs", () => {
  const ok = (argv: string[]) => {
    const r = parseArgs(DEF, argv);
    if (r.kind !== "ok") throw new Error(JSON.stringify(r));
    return r.args;
  };
  const error = (argv: string[]) => {
    const r = parseArgs(DEF, argv);
    return r.kind === "error" ? r.message : `not an error: ${r.kind}`;
  };

  test("--name value, --name=value, booleans, comma lists, repeatables, positionals, --", () => {
    expect(
      ok(["x", "--kind", "a", "--limit=5", "--paths", "a.ts,b.ts", "--commit", "abc1234", "--commit=def5678", "--include-drafts", "y", "--", "--z"]),
    ).toEqual({ kind: "a", limit: 5, paths: ["a.ts", "b.ts"], commit: ["abc1234", "def5678"], include_drafts: true, first: "x", rest: ["y", "--z"] });
    expect(argKey("include-drafts")).toBe("include_drafts");
  });

  test("refuses, never guesses: unknown options, bad values, missing values, repeats", () => {
    expect(error(["x", "--nope"])).toContain("unknown option --nope");
    expect(error(["x", "--kind", "c"])).toContain("must be one of a, b");
    expect(error(["x", "--limit", "0"])).toContain("at least 1");
    expect(error(["x", "--limit", "1.5"])).toContain("whole number");
    expect(error(["x", "--summary"])).toContain("needs a value");
    expect(error(["x", "--summary", "--kind"])).toContain("needs a value");
    expect(error(["x", "--include-drafts=yes"])).toContain("takes no value");
    expect(error(["x", "--summary", "a", "--summary", "b"])).toContain("more than once");
    expect(error(["x", "--paths", "a", "--paths", "b"])).toContain("more than once");
    expect(error([])).toContain("<first> is required");
  });

  test("--help asks for usage; a value starting with -- is possible only with =", () => {
    expect(parseArgs(DEF, ["--help"]).kind).toBe("help");
    expect(ok(["x", "--summary=--literal"]).summary).toBe("--literal");
    expect(usage(DEF)).toContain("usage: enou demo <first> [<rest>...]");
  });
});

describe("findRoot and toRepoPath", () => {
  test("walks up to the nearest .knowledge/, so a subdirectory behaves like the root", () => {
    const root = tempRoot();
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    expect(findRoot(join(root, "src", "deep"), {})).toEqual({ ok: true, root });
  });

  test("ENOU_ROOT wins; the git top level is the fallback; neither is an error", () => {
    const a = tempRoot();
    const b = tempRoot(false);
    expect(findRoot(a, { ENOU_ROOT: b })).toEqual({ ok: true, root: b });
    gitInit(b);
    mkdirSync(join(b, "x"));
    expect(findRoot(join(b, "x"), {})).toEqual({ ok: true, root: b });
    expect(findRoot(tempRoot(false), {}).ok).toBe(false);
  });

  test("paths are taken relative to the current directory and expressed relative to the root", () => {
    const root = tempRoot();
    mkdirSync(join(root, "src", "util"), { recursive: true });
    expect(toRepoPath(root, join(root, "src"), "util/context.ts")).toEqual({ ok: true, path: "src/util/context.ts" });
    expect(toRepoPath(root, root, "gone/deleted.ts")).toEqual({ ok: true, path: "gone/deleted.ts" });
    expect(toRepoPath(root, root, "../elsewhere").ok).toBe(false);
  });

  test("a symlinked checkout does not make files look outside the repository", () => {
    const root = tempRoot();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.ts"), "");
    const link = join(tempRoot(false), "link");
    symlinkSync(root, link);
    expect(toRepoPath(root, link, "src/a.ts")).toEqual({ ok: true, path: "src/a.ts" });
  });
});

function run(argv: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { cwd, env, out: (t) => out.push(t), err: (t) => err.push(t) };
  return main(argv, io).then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

describe("main: exit codes (contracts/cli.md)", () => {
  test("0 for help, 1 for anything the user got wrong", async () => {
    const root = tempRoot();
    expect((await run(["--help"], root)).code).toBe(0);
    expect((await run(["lint", "--help"], root)).code).toBe(0);
    expect((await run([], root)).code).toBe(1);
    expect((await run(["nonsense"], root)).code).toBe(1);
    expect((await run(["lint", "--bogus"], root)).code).toBe(1);
    expect((await run(["lint"], tempRoot(false))).code).toBe(1);
  });

  test("2 when lint has findings, 0 when it has none", async () => {
    const root = tempRoot();
    putRecord(root, "records", front({ id: IDS.a }));
    expect((await run(["lint"], root)).code).toBe(0);
    put(root, `.knowledge/records/${IDS.b}.md`, "not a record");
    const r = await run(["lint", "--json"], root);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).findings[0]).toMatchObject({ check: "parse", path: `.knowledge/records/${IDS.b}.md` });
  });

  test("3 when the tool itself fails — never confused with a refusal", async () => {
    const root = tempRoot(false);
    mkdirSync(join(root, ".knowledge"));
    writeFileSync(join(root, ".knowledge", "records"), "a file where a directory must be");
    const r = await run(["lint"], root);
    expect(r.code).toBe(3);
    expect(r.err).toContain("internal error");
    expect(r.err).not.toContain("    at "); // no stack trace without ENOU_DEBUG
  });

  test("the real binary runs from a subdirectory", () => {
    const root = tempRoot();
    mkdirSync(join(root, "src"));
    putRecord(root, "records", front({ id: IDS.a }));
    const main = join(import.meta.dir, "..", "src", "cli", "main.ts");
    const r = spawnSync("bun", [main, "lint"], { cwd: join(root, "src"), encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no findings");
  });
});
