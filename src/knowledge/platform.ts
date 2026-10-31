// The platform seam: the ONLY file allowed to touch `Bun.*` globals (plan.md, binding test #13,
// enforced by test/platform-seam.test.ts). Spec 002 must choose between a Bun-compiled binary and a
// Node-compatible bundle; keeping every runtime-specific call here makes that one file's change.
//
// Swapping the YAML parser means re-running the SHA fixtures in test/record.test.ts — the scalar
// hazards (`0123456` → a number, `6e40653` → Infinity) belong to a specific parser, not to YAML.

/** Parse one YAML document. Throws on invalid YAML. */
export function parseYaml(text: string): unknown {
  return Bun.YAML.parse(text);
}

/** Glob match of a repository-relative POSIX path. */
export function globMatch(pattern: string, path: string): boolean {
  return new Bun.Glob(pattern).match(path);
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run git synchronously. A missing git binary is reported as exit 127, never thrown. */
export function git(args: string[], cwd: string): GitResult {
  try {
    const r = Bun.spawnSync(["git", ...args], {
      cwd,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e) };
  }
}
