#!/usr/bin/env bun
// `enou` — the command surface every other surface calls (contracts/cli.md, FR-022).
//
// Exit codes: 0 success · 1 refused (bad input, failed validation, secret detected) · 2 `lint`
// found something a reviewer must see · 3 the tool itself failed. 3 is separate from 1 so a broken
// tool never looks like a careful one; the stack trace is printed only with ENOU_DEBUG set.

import { COMMANDS, parseArgs, usage, type Args, type CommandDef } from "./commands";
import { findRoot } from "./root";
import { EXIT } from "./util";

export { EXIT };

export interface Io {
  cwd: string;
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Reads all of stdin (for `--body-file -` and hook payloads). Injected by tests. */
  stdin?: () => string;
}

type Handler = (args: Args, ctx: { root: string; io: Io }) => number | Promise<number>;

// Handlers load on demand: a process runs one command, and loading every handler at startup cost
// ~25 ms — more than the whole budget of a hook that fires on every file read (contracts/hooks.md §6).
const HANDLERS: Record<string, () => Promise<Handler>> = {
  record: () => import("./record").then((m) => m.runRecord),
  drafts: () => import("./drafts").then((m) => m.runDrafts),
  accept: () => import("./drafts").then((m) => m.runAccept),
  reject: () => import("./drafts").then((m) => m.runReject),
  why: () => import("./why").then((m) => m.runWhy),
  brief: () => import("./view").then((m) => m.runBrief),
  view: () => import("./view").then((m) => m.runView),
  log: () => import("./view").then((m) => m.runLog),
  show: () => import("./view").then((m) => m.runShow),
  redact: () => import("./redact").then((m) => m.runRedact),
  lint: () => import("./lint").then((m) => m.runLint),
  modules: () => import("./modules").then((m) => m.runModules),
  recall: () => import("./recall").then((m) => m.runRecall),
  hook: () => import("./hook").then((m) => m.runHook),
};

function topUsage(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length)) + 2;
  return [
    "usage: enou <command> [arguments]",
    "",
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}${c.summary.split(". ")[0]!.replace(/\.$/, "")}`),
    "",
    "enou <command> --help shows a command's arguments.",
  ].join("\n");
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  try {
    const [name, ...rest] = argv;
    if (name === undefined) {
      io.err(topUsage());
      return EXIT.refused;
    }
    if (name === "--help" || name === "help") {
      io.out(topUsage());
      return EXIT.ok;
    }
    const def: CommandDef | undefined = COMMANDS.find((c) => c.name === name);
    const handler = def && HANDLERS[def.name];
    if (!def || !handler) {
      io.err(`enou: unknown command ${JSON.stringify(name)}\n\n${topUsage()}`);
      return EXIT.refused;
    }
    const parsed = parseArgs(def, rest);
    if (parsed.kind === "help") {
      io.out(usage(def));
      return EXIT.ok;
    }
    if (parsed.kind === "error") {
      io.err(`enou ${def.name}: ${parsed.message}\n\n${usage(def)}`);
      return EXIT.refused;
    }
    const root = findRoot(io.cwd, io.env);
    if (!root.ok) {
      // An agent hook in a repository without a knowledge store is a silent no-op (FR-042).
      if (def.name === "hook") return EXIT.ok;
      io.err(`enou ${def.name}: ${root.message}`);
      return EXIT.refused;
    }
    return await (await handler())(parsed.args, { root: root.root, io });
  } catch (e) {
    io.err(`enou: internal error: ${e instanceof Error ? e.message : String(e)}`);
    if (io.env.ENOU_DEBUG && e instanceof Error && e.stack) io.err(e.stack);
    return EXIT.internal;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    out: (t) => process.stdout.write(t.endsWith("\n") ? t : `${t}\n`),
    err: (t) => process.stderr.write(t.endsWith("\n") ? t : `${t}\n`),
  });
  process.exit(code);
}
