// Redaction — the single permitted mutation of a record (FR-033, FR-034).
//
// Explicit, never automatic; a person's step, never offered to agents. It replaces the named fields
// with "[redacted]" and records {date, reason, fields} in the record itself, which is exactly the
// change shape `lint` permits. It hides content going forward and says so: the original is still in
// git history, and a redacted credential must be rotated — redaction alone does not make it safe.

import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { today } from "./capture";
import { isUlid } from "./id";
import { prepareRecord, stringFields, type Issue } from "./record";
import { scanSecrets } from "./secrets";
import { entryPath, loadStore } from "./store";

export const REDACTED = "[redacted]";
/** Fields whose content can be replaced without breaking the record's structure. */
export const REDACTABLE = ["summary", "body", "rejected", "provenance.source"] as const;

export type RedactResult =
  | { ok: true; path: string; fields: string[]; credentials: string[] }
  | { ok: false; issues: Issue[] };

export function redactRecord(root: string, id: string, reason: string, fields: readonly string[]): RedactResult {
  const fail = (field: string, message: string): RedactResult => ({ ok: false, issues: [{ field, message }] });
  if (!isUlid(id)) return fail("id", "is not a ULID");
  if (reason.trim() === "") return fail("reason", "a redaction needs a stated reason (FR-033)");
  const unknown = fields.filter((f) => !(REDACTABLE as readonly string[]).includes(f));
  if (!fields.length || unknown.length)
    return fail("fields", `name one or more of ${REDACTABLE.join(", ")}${unknown.length ? `; not ${unknown.join(", ")}` : ""}`);

  const entry = loadStore(root).entries.find((e) => e.id === id);
  if (!entry) return fail("id", "no record with this id");
  if (entry.area === "inbox") return fail("id", "is a draft — edit or reject it directly; only records are redacted");
  if (!entry.parsed.ok || entry.parsed.issues.length) return { ok: false, issues: entry.parsed.issues };
  const { data, body } = entry.parsed;
  if (data.redaction !== undefined)
    return fail("redaction", "this record is already redacted; a second redaction is not supported yet");

  const before = new Map(stringFields(data, body));
  const credentials = new Set<string>();
  for (const f of fields)
    for (const [path, text] of before)
      if (path === f || path.startsWith(`${f}[`))
        for (const m of scanSecrets([[path, text]])) credentials.add(m.pattern);

  const next: Record<string, unknown> = structuredClone(data);
  let nextBody = body;
  for (const f of fields) {
    if (f === "body") nextBody = REDACTED;
    else if (f === "summary") next.summary = REDACTED;
    else if (f === "rejected" && Array.isArray(next.rejected)) next.rejected = next.rejected.map(() => REDACTED);
    else if (f === "provenance.source" && typeof (next.provenance as Record<string, unknown>).source === "string")
      (next.provenance as Record<string, unknown>).source = REDACTED;
  }
  next.redaction = { date: today(), reason: reason.trim(), fields: [...fields].sort() };

  // Redaction must not itself leave a secret behind in a field it did not touch.
  const prepared = prepareRecord(next, nextBody);
  if (!prepared.ok) return prepared;

  const target = join(root, entryPath("records", id));
  const tmp = `${target}.redact-${process.pid}`;
  writeFileSync(tmp, prepared.text, { encoding: "utf8", flag: "wx" });
  renameSync(tmp, target);
  return { ok: true, path: entryPath("records", id), fields: [...fields].sort(), credentials: [...credentials].sort() };
}
