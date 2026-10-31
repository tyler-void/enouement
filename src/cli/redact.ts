// `enou redact <id> --reason <text> --fields <f>,...` (FR-033). A person's step.

import { redactRecord } from "../knowledge/redact";
import type { Args } from "./commands";
import { EXIT, json, list, refuse, type Ctx } from "./util";

export function runRedact(args: Args, ctx: Ctx): number {
  const r = redactRecord(ctx.root, String(args.id), String(args.reason), list(args.fields));
  if (!r.ok) return refuse(ctx, "redact", r.issues);
  const notice = [
    `redacted ${r.fields.join(", ")} in ${r.path}.`,
    "The original content still exists in git history. Redaction hides it from here on; it does not remove it.",
    ...(r.credentials.length
      ? [`The redacted content matched ${r.credentials.join(", ")}: treat that credential as leaked and ROTATE IT NOW.`]
      : []),
  ];
  if (args.json) json(ctx, { path: r.path, fields: r.fields, credential_patterns: r.credentials, notice });
  else for (const line of notice) ctx.io.out(line);
  return EXIT.ok;
}
