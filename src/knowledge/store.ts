// The flat stores (FR-041, FR-043, data-model §1):
//
//   .knowledge/records/<ULID>.md   records — immutable from acceptance (FR-007, FR-034)
//   .knowledge/inbox/<ULID>.md     drafts — same format; only the directory makes a file a draft
//
// The store is read once per command and the snapshot handed down, so every check is linear in the
// number of files (contracts/cli.md, lint). This module never rewrites a record: the only writer of
// records/ is acceptance (accept.ts, US1). Here a draft can be written, atomically and exclusively.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isUlid } from "./id";
import { parseRecordText, prepareRecord, validateRecord, type Issue, type ValidateOptions } from "./record";
import { buildTrust } from "./trust";

export const STORE_DIR = ".knowledge";
export const AREAS = ["records", "inbox"] as const;
export type Area = (typeof AREAS)[number];

export interface StoreEntry {
  area: Area;
  /** The identifier the filename claims. */
  id: string;
  /** Repository-relative, `/`-separated. */
  path: string;
  text: string;
  /** Parse failure, or the parsed data with its validation issues (read-time rules: no summary cap). */
  parsed:
    | { ok: true; data: Record<string, unknown>; body: string; issues: Issue[] }
    | { ok: false; issues: Issue[] };
}

/** Something in a store directory that is not a `<ULID>.md` file — the stores are flat (FR-041). */
export interface Stray {
  path: string;
  reason: string;
}

export interface StoreSnapshot {
  root: string;
  entries: StoreEntry[];
  strays: Stray[];
}

export function areaDir(root: string, area: Area): string {
  return join(root, STORE_DIR, area);
}

export function entryPath(area: Area, id: string): string {
  return `${STORE_DIR}/${area}/${id}.md`;
}

/** Read every record and draft once. Missing directories are empty stores, not errors. */
export function loadStore(root: string): StoreSnapshot {
  const entries: StoreEntry[] = [];
  const strays: Stray[] = [];
  for (const area of AREAS) {
    const dir = areaDir(root, area);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const rel = `${STORE_DIR}/${area}/${name}`;
      if (name === ".gitkeep") continue;
      if (name.startsWith(".") && name.includes(".tmp-")) {
        strays.push({ path: rel, reason: "a temporary file left by an interrupted write" });
        continue;
      }
      if (statSync(join(dir, name)).isDirectory()) {
        strays.push({ path: rel, reason: "a subdirectory — the store is flat, one file per record (FR-041)" });
        continue;
      }
      const id = name.endsWith(".md") ? name.slice(0, -3) : "";
      if (!isUlid(id)) {
        strays.push({ path: rel, reason: "not named <ULID>.md" });
        continue;
      }
      const text = readFileSync(join(dir, name), "utf8");
      const p = parseRecordText(text);
      const parsed: StoreEntry["parsed"] = p.ok
        ? { ok: true, data: p.data, body: p.body, issues: idIssues(id, p.data).concat(validateRecord(p.data, p.body)) }
        : p;
      entries.push({ area, id, path: rel, text, parsed });
    }
  }
  return { root, entries, strays };
}

function idIssues(fileId: string, data: Record<string, unknown>): Issue[] {
  return data.id !== undefined && data.id !== fileId
    ? [{ field: "id", message: `is ${JSON.stringify(data.id)} but the file is named ${fileId}.md` }]
    : [];
}

export type WriteResult = { ok: true; id: string; path: string } | { ok: false; issues: Issue[] };

/**
 * Write a draft to `inbox/` (FR-043). Refuses, writing nothing, when the draft fails validation or
 * the secret scan, when its id is already used in either store, or when `supersedes` names anything
 * other than a current record (data-model §3 rules 4, 7, 13). The write is atomic and exclusive: a
 * temporary file is hard-linked into place, which fails rather than overwrite an existing file.
 */
export function writeDraft(
  snapshot: StoreSnapshot,
  data: Record<string, unknown>,
  body: string,
  opts: ValidateOptions = {},
): WriteResult {
  const prepared = prepareRecord(data, body, opts);
  if (!prepared.ok) return prepared;
  const id = data.id as string;
  const issues: Issue[] = [];
  if (snapshot.entries.some((e) => e.id === id))
    issues.push({ field: "id", message: `${id} is already used in the store` });
  if (typeof data.supersedes === "string") {
    const trust = buildTrust(snapshot);
    if (!trust.records.has(data.supersedes))
      issues.push({
        field: "supersedes",
        message: trust.drafts.has(data.supersedes)
          ? `${data.supersedes} is a draft; only an accepted record can be superseded`
          : `no record ${data.supersedes} exists`,
      });
  }
  if (issues.length) return { ok: false, issues };
  const rel = entryPath("inbox", id);
  try {
    writeExclusive(join(snapshot.root, rel), prepared.text);
  } catch (e) {
    return { ok: false, issues: [{ field: "(file)", message: `could not write ${rel}: ${(e as Error).message}` }] };
  }
  return { ok: true, id, path: rel };
}

/** Atomic, exclusive create: never overwrites, never leaves a half-written file at `target`. */
export function writeExclusive(target: string, text: string): void {
  const dir = join(target, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${target.split(/[\\/]/).pop()}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
  try {
    linkSync(tmp, target);
  } finally {
    unlinkSync(tmp);
  }
}
