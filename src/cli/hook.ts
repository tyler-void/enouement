// `enou hook <event>` — Claude Code hook entry point (contracts/hooks.md §3–§6). US3/US4.
// PLACEHOLDER: replaced by the hook implementation. A hook must never block the agent, so even the
// placeholder exits 0 and prints nothing.

import type { Args } from "./commands";
import { EXIT, type Ctx } from "./util";

export function runHook(_args: Args, _ctx: Ctx): number {
  return EXIT.ok;
}
