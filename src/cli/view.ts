// `enou view` · `enou log` · `enou brief` · `enou show` — US3 (T043–T045, T044a–b).
// PLACEHOLDER: replaced by the US3 implementation. Until then each command refuses, never guesses.

import type { Args } from "./commands";
import { EXIT, type Ctx } from "./util";

const notYet = (name: string) => (_args: Args, ctx: Ctx) => {
  ctx.io.err(`enou ${name}: not built yet`);
  return EXIT.refused;
};

export const runView = notYet("view");
export const runLog = notYet("log");
export const runBrief = notYet("brief");
export const runShow = notYet("show");
