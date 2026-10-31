// `enou hook <event>` — the Claude Code hook entry point (contracts/hooks.md §3–§7).
//
// Always exits 0: delivering knowledge must never block a read, and the capture offer is a JSON
// `decision`, not an exit code. A failure is reported on stderr; "nothing to say" prints nothing.

import { readFileSync } from "node:fs";
import { runHookEvent, type HookEvent } from "../knowledge/hooks";
import type { Args } from "./commands";
import { EXIT, type Ctx } from "./util";

export async function runHook(args: Args, ctx: Ctx): Promise<number> {
  const event = String(args.event) as HookEvent;
  try {
    const stdin = ctx.io.stdin ? ctx.io.stdin() : readFileSync(0, "utf8");
    const r = await runHookEvent(event, stdin, ctx.io.env, ctx.root);
    if (r.stdout) ctx.io.out(r.stdout);
    if (r.stderr) ctx.io.err(r.stderr);
  } catch (e) {
    ctx.io.err(`enou hook ${event}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return EXIT.ok;
}
