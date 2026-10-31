// The local git hooks (tasks.md T065; contracts/hooks.md §1, §5; FR-042; plan.md binding test #11).
// They are run here directly with `sh`; nothing in this repository is reconfigured to use them.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commitAll, front, gitInit, IDS, put, putRecord, sh, tempRoot } from "./support/repo";

const HOOKS = join(import.meta.dir, "..", ".githooks");
const MAIN = join(import.meta.dir, "..", "src", "cli", "main.ts");

function which(cmd: string): string {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.stdout.trim();
}

/** A PATH with git and sh but no enou. */
function bareBin(): string {
  const dirs = [...new Set([dirname(which("git")), dirname(which("sh"))])];
  for (const d of dirs) if (existsSync(join(d, "enou"))) throw new Error(`${d} has an enou; cannot test its absence`);
  return dirs.join(":");
}

/** A directory holding an `enou` that runs this checkout's CLI — or one that behaves as told. */
function shim(behaviour: "real" | number): string {
  const dir = tempRoot(false);
  const script =
    behaviour === "real" ? `#!/bin/sh\nexec "${process.execPath}" "${MAIN}" "$@"\n` : `#!/bin/sh\necho broken >&2\nexit ${behaviour}\n`;
  writeFileSync(join(dir, "enou"), script);
  chmodSync(join(dir, "enou"), 0o755);
  return dir;
}

function hook(name: "pre-commit" | "pre-push", cwd: string, path: string, stdin = "", args: string[] = []) {
  const r = spawnSync("sh", [join(HOOKS, name), ...args], {
    cwd,
    input: stdin,
    encoding: "utf8",
    env: { PATH: path, HOME: process.env.HOME ?? "/tmp", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function repo(withStore = true): string {
  const root = tempRoot(withStore);
  gitInit(root);
  put(root, "src/a.ts", "export const a = 1;\n");
  if (withStore) put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n");
  commitAll(root, "base");
  return root;
}

describe("FR-042 — silent when not installed or not set up", () => {
  for (const name of ["pre-commit", "pre-push"] as const) {
    test(`${name}: enou absent from PATH → exit 0, no output`, () => {
      const r = hook(name, repo(), bareBin(), "refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n", ["origin"]);
      expect(r).toEqual({ code: 0, out: "", err: "" });
    });

    test(`${name}: no .knowledge/ → exit 0, no output, even with enou installed`, () => {
      const r = hook(name, repo(false), `${shim("real")}:${bareBin()}`, "", ["origin"]);
      expect(r).toEqual({ code: 0, out: "", err: "" });
    });
  }
});

describe("pre-commit", () => {
  test("passes a clean staged change", () => {
    const root = repo();
    put(root, "src/a.ts", "export const a = 2;\n");
    sh(root, "git", ["add", "src/a.ts"]);
    const r = hook("pre-commit", root, `${shim("real")}:${bareBin()}`);
    expect(r.code).toBe(0);
  });

  test("blocks (exit 2) a staged edit to an accepted record", () => {
    const root = repo();
    const rel = putRecord(root, "records", front({ id: IDS.a, paths: ["src/a.ts"] }));
    commitAll(root, "record");
    put(root, rel, readFileSync(join(root, rel), "utf8").replace("an unquoted", "a sneaky"));
    sh(root, "git", ["add", rel]);
    const r = hook("pre-commit", root, `${shim("real")}:${bareBin()}`);
    expect(r.code).toBe(2);
    expect(r.out).toContain("immutable");
  });

  test("an installed but broken enou blocks — it never passes silently", () => {
    const r = hook("pre-commit", repo(), `${shim(3)}:${bareBin()}`);
    expect(r.code).toBe(3);
  });

  test("exit 1 (enou refused its arguments) does not block, but says so", () => {
    const r = hook("pre-commit", repo(), `${shim(1)}:${bareBin()}`);
    expect(r.code).toBe(0);
    expect(r.err).toContain("refused to run");
  });
});

describe("pre-push", () => {
  test("judges FR-015 over the pushed commits: a module changed with no knowledge blocks", () => {
    const root = repo();
    const before = sh(root, "git", ["rev-parse", "HEAD"]).trim();
    put(root, "src/a.ts", "export const a = 3;\n");
    commitAll(root, "change a");
    const after = sh(root, "git", ["rev-parse", "HEAD"]).trim();
    const line = `refs/heads/main ${after} refs/heads/main ${before}\n`;
    const r = hook("pre-push", root, `${shim("real")}:${bareBin()}`, line, ["origin"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("unrecorded");

    sh(root, "git", ["commit", "-q", "--allow-empty", "-m", "decline\n\nKnowledge-None: trivial"]);
    const again = `refs/heads/main ${sh(root, "git", ["rev-parse", "HEAD"]).trim()} refs/heads/main ${before}\n`;
    expect(hook("pre-push", root, `${shim("real")}:${bareBin()}`, again, ["origin"]).code).toBe(0);
  });

  test("a new branch with no known base checks the store only, and says so", () => {
    const root = repo();
    const sha = sh(root, "git", ["rev-parse", "HEAD"]).trim();
    const r = hook("pre-push", root, `${shim("real")}:${bareBin()}`, `refs/heads/x ${sha} refs/heads/x ${"0".repeat(40)}\n`, ["origin"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("no base to compare");
  });

  test("deleting a remote ref checks nothing", () => {
    const root = repo();
    const r = hook("pre-push", root, `${shim(3)}:${bareBin()}`, `(delete) ${"0".repeat(40)} refs/heads/x ${"1".repeat(40)}\n`, ["origin"]);
    expect(r).toEqual({ code: 0, out: "", err: "" });
  });
});

