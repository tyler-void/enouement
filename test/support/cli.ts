// Run `enou` in-process against a directory, capturing stdout, stderr and the exit code.

import { main, type Io } from "../../src/cli/main";

export interface Run {
  code: number;
  out: string;
  err: string;
}

export async function enou(cwd: string, argv: string[], opts: { stdin?: string; env?: Record<string, string> } = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd,
    env: { ...opts.env },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    stdin: () => opts.stdin ?? "",
  };
  const code = await main(argv, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** `enou record` with sensible defaults; returns the new draft id. */
export async function capture(cwd: string, extra: string[] = [], defaults: Record<string, string> = {}): Promise<string> {
  const args = {
    "--kind": "gotcha",
    "--summary": "a short summary",
    "--paths": "src/a.ts",
    "--body": "Why it is so.",
    ...defaults,
  };
  const argv = ["record", ...Object.entries(args).flat(), ...extra, "--json"];
  const r = await enou(cwd, argv);
  if (r.code !== 0) throw new Error(`record failed: ${r.err}`);
  return JSON.parse(r.out).id;
}
