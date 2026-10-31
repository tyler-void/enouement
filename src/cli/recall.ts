// `enou recall` — refuses until a measured ranker ships (FR-049, plan.md binding condition 1).

import { RECALL_REFUSAL } from "../knowledge/recall";
import type { Args } from "./commands";
import { EXIT, json, type Ctx } from "./util";

export function runRecall(args: Args, ctx: Ctx): number {
  if (args.json) json(ctx, { results: [], error: RECALL_REFUSAL });
  else ctx.io.err(`enou recall: ${RECALL_REFUSAL}`);
  return EXIT.refused;
}
