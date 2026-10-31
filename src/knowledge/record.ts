// One knowledge record: its on-disk form, the canonical writer, and validation.
//
// A record (or a draft — same format, different directory) is YAML front matter between `---`
// lines, then a Markdown body (contracts/formats.md §1, data-model §2.1).
//
// The writer is canonical and hand-written, never a general YAML dump (data-model §2.8):
//   - every string scalar is double-quoted — unquoted, `0123456` parses as a number and `6e40653`
//     as Infinity (research.md §9);
//   - keys in a fixed order, unknown keys after them in code-unit order, nested the same way;
//   - UTF-8, LF, no byte-order mark;
//   - parse → serialise is byte-identical, which `lint` enforces.
// Before anything is written, the serialised bytes are parsed again and must equal what was
// validated: an object can validate and still serialise to text the parser rejects.

import { isUlid } from "./id";
import { parseYaml } from "./platform";
import { scanSecrets, type SecretMatch } from "./secrets";

export const KINDS = ["decision", "invariant", "gotcha", "convention"] as const;
export type Kind = (typeof KINDS)[number];

export const ORIGINS = ["contemporaneous", "backfilled", "oral"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface Provenance {
  origin: Origin;
  source?: string;
  date: string;
  [extra: string]: unknown;
}

export interface Redaction {
  date: string;
  reason: string;
  fields: string[];
  [extra: string]: unknown;
}

/** The front matter of a valid record. Keys the tool does not know are kept, never dropped. */
export interface FrontMatter {
  id: string;
  kind: Kind;
  summary: string;
  provenance: Provenance;
  paths: string[];
  symbols?: string[];
  spec?: string;
  commits?: string[];
  supersedes?: string;
  rejected?: string[];
  redaction?: Redaction;
  [extra: string]: unknown;
}

export interface KnowledgeRecord {
  front: FrontMatter;
  body: string;
}

/** A refusal or finding, located at a dotted field path, or `(file)` for the file as a whole. */
export interface Issue {
  field: string;
  message: string;
}

const TOP_ORDER = [
  "id",
  "kind",
  "summary",
  "provenance",
  "paths",
  "symbols",
  "spec",
  "commits",
  "supersedes",
  "rejected",
  "redaction",
];
const NESTED_ORDER: Record<string, string[]> = {
  provenance: ["origin", "source", "date"],
  redaction: ["date", "reason", "fields"],
};

// ---------------------------------------------------------------------------------------------
// Paths and symbols

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Checks a repository-relative path as it must be written (data-model §2.1): `/` separators, no
 * leading `./`, no repeated `/`, no `.` or `..` segment, never absolute. Returns an error message,
 * or null when the path is acceptable. Refuses rather than repairs.
 */
export function checkRepoPath(p: unknown, opts: { glob?: boolean; dirSlash?: boolean } = {}): string | null {
  const { glob = true, dirSlash = true } = opts;
  if (typeof p !== "string") return "must be a string";
  if (p === "") return "must not be empty";
  if (p !== p.trim()) return "must not start or end with whitespace";
  if (/[\u0000-\u001f\u007f]/.test(p)) return "must not contain control characters";
  if (p.includes("\\")) return "must use / as the separator, not \\";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "must be relative to the repository root, not absolute";
  if (!glob && GLOB_CHARS.test(p)) return "must name one file, not a glob";
  const trailing = p.endsWith("/");
  if (trailing && !dirSlash) return "must name a file, not a directory";
  const segments = (trailing ? p.slice(0, -1) : p).split("/");
  for (const s of segments) {
    if (s === "") return "must not contain an empty segment (repeated or leading /)";
    if (s === ".") return "must not contain a `.` segment (write it without ./)";
    if (s === "..") return "must not contain a `..` segment";
  }
  return null;
}

const SYMBOL_NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/** Splits `<path>#<name>`; returns an error message, or the parts. */
export function parseSymbol(s: unknown): { path: string; name: string } | string {
  if (typeof s !== "string") return "must be a string of the form <path>#<name>";
  const at = s.lastIndexOf("#");
  if (at <= 0) return "must be anchored to a file, as <path>#<name>";
  const path = s.slice(0, at);
  const name = s.slice(at + 1);
  const pathError = checkRepoPath(path, { glob: false, dirSlash: false });
  if (pathError) return `path part ${pathError}`;
  if (!SYMBOL_NAME.test(name)) return "name part must be an identifier as written in the source";
  return { path, name };
}

// ---------------------------------------------------------------------------------------------
// Reading

export type ParsedText =
  | { ok: true; data: Record<string, unknown>; body: string }
  | { ok: false; issues: Issue[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Splits front matter from body and parses the YAML. Says nothing about whether it is valid. */
export function parseRecordText(text: string): ParsedText {
  const normalised = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalised.split("\n");
  if (lines[0] !== "---") return fileIssue("does not start with a `---` front-matter line");
  const close = lines.indexOf("---", 1);
  if (close < 0) return fileIssue("front matter is not closed by a `---` line");
  let data: unknown;
  try {
    data = parseYaml(lines.slice(1, close).join("\n") + "\n");
  } catch (e) {
    return fileIssue(`front matter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isPlainObject(data)) return fileIssue("front matter must be a mapping of keys to values");
  const rest = lines.slice(close + 1);
  while (rest.length && rest[0]!.trim() === "") rest.shift();
  return { ok: true, data, body: rest.join("\n").trimEnd() };
}

function fileIssue(message: string): ParsedText {
  return { ok: false, issues: [{ field: "(file)", message }] };
}

// ---------------------------------------------------------------------------------------------
// Validation (data-model §3)

export interface ValidateOptions {
  /** The summary length cap (FR-013/FR-031), in characters. Capture-time only: omit at read time. */
  maxSummary?: number;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

export function isCalendarDate(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "number") return Number.isFinite(v) ? "a number" : "a non-finite number";
  return typeof v === "object" ? "a mapping" : `a ${typeof v}`;
}

function notAString(v: unknown): string {
  const hint = typeof v === "number" ? " — write it double-quoted; unquoted, YAML read it as a number" : "";
  return `must be a string, found ${typeName(v)}${hint}`;
}

function oneLine(field: string, v: unknown, issues: Issue[]): v is string {
  if (typeof v !== "string") {
    issues.push({ field, message: v === undefined ? "is required" : notAString(v) });
    return false;
  }
  if (v.trim() === "") issues.push({ field, message: "must not be empty" });
  else if (/[\r\n]/.test(v)) issues.push({ field, message: "must be a single line" });
  else if (v !== v.trim()) issues.push({ field, message: "must not start or end with whitespace" });
  return true;
}

function stringList(field: string, v: unknown, issues: Issue[], each: (s: string, f: string) => string | null) {
  if (!Array.isArray(v)) {
    issues.push({ field, message: `must be a list, found ${typeName(v)}` });
    return;
  }
  v.forEach((item, i) => {
    const f = `${field}[${i}]`;
    if (typeof item !== "string") issues.push({ field: f, message: notAString(item) });
    else {
      const err = each(item, f);
      if (err) issues.push({ field: f, message: err });
    }
  });
}

const nonEmptyLine = (s: string) =>
  s.trim() === "" ? "must not be empty" : /[\r\n]/.test(s) ? "must be a single line" : null;

/** Validates parsed front matter and body. Never coerces a value into the type it should have had. */
export function validateRecord(data: Record<string, unknown>, body: string, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];

  if (data.id === undefined) issues.push({ field: "id", message: "is required" });
  else if (typeof data.id !== "string") issues.push({ field: "id", message: notAString(data.id) });
  else if (!isUlid(data.id)) issues.push({ field: "id", message: "must be a 26-character upper-case ULID" });

  if (data.kind === undefined) issues.push({ field: "kind", message: "is required" });
  else if (!KINDS.includes(data.kind as Kind))
    issues.push({ field: "kind", message: `must be one of ${KINDS.join(", ")}` });

  if (oneLine("summary", data.summary, issues) && opts.maxSummary !== undefined) {
    const length = [...(data.summary as string)].length;
    if (length > opts.maxSummary)
      issues.push({
        field: "summary",
        message: `is ${length} characters; the limit is ${opts.maxSummary} — summaries are never cut, so shorten it (FR-031)`,
      });
  }

  const prov = data.provenance;
  let origin: unknown;
  if (prov === undefined) issues.push({ field: "provenance", message: "is required" });
  else if (!isPlainObject(prov)) issues.push({ field: "provenance", message: `must be a mapping, found ${typeName(prov)}` });
  else {
    origin = prov.origin;
    if (origin === undefined) issues.push({ field: "provenance.origin", message: "is required" });
    else if (!ORIGINS.includes(origin as Origin))
      issues.push({ field: "provenance.origin", message: `must be one of ${ORIGINS.join(", ")}` });
    if (prov.source !== undefined) oneLine("provenance.source", prov.source, issues);
    else if (origin === "backfilled" || origin === "oral")
      issues.push({ field: "provenance.source", message: `is required when origin is ${origin} (FR-036)` });
    if (prov.date === undefined) issues.push({ field: "provenance.date", message: "is required" });
    else if (typeof prov.date !== "string") issues.push({ field: "provenance.date", message: notAString(prov.date) });
    else if (!isCalendarDate(prov.date))
      issues.push({ field: "provenance.date", message: "must be a real calendar date written YYYY-MM-DD" });
  }

  if (data.paths === undefined) issues.push({ field: "paths", message: "is required" });
  else {
    stringList("paths", data.paths, issues, (s) => checkRepoPath(s));
    if (Array.isArray(data.paths) && data.paths.length === 0)
      issues.push({ field: "paths", message: "must name at least one path" });
  }

  if (data.symbols !== undefined)
    stringList("symbols", data.symbols, issues, (s) => {
      const r = parseSymbol(s);
      return typeof r === "string" ? r : null;
    });

  if (data.spec !== undefined) {
    if (typeof data.spec !== "string") issues.push({ field: "spec", message: notAString(data.spec) });
    else {
      const err = checkRepoPath(data.spec, { glob: false, dirSlash: false });
      if (err) issues.push({ field: "spec", message: err });
    }
  }

  if (data.commits !== undefined) {
    stringList("commits", data.commits, issues, (s) =>
      COMMIT.test(s) ? null : "must be 7–40 lower-case hexadecimal characters",
    );
    if (origin !== undefined && origin !== "backfilled")
      issues.push({
        field: "commits",
        message: "is stored only on backfilled records; the implementing commit is derived from git (FR-002)",
      });
  }

  if (data.supersedes !== undefined) {
    if (!isUlid(data.supersedes)) issues.push({ field: "supersedes", message: "must be the ULID of a record" });
    else if (data.supersedes === data.id) issues.push({ field: "supersedes", message: "must not name the record itself" });
  }

  if (data.rejected !== undefined) {
    stringList("rejected", data.rejected, issues, nonEmptyLine);
    if (data.kind === "decision" && Array.isArray(data.rejected) && data.rejected.length === 0)
      issues.push({ field: "rejected", message: "a decision must name at least one rejected alternative (FR-001a)" });
  } else if (data.kind === "decision")
    issues.push({ field: "rejected", message: "is required for a decision: name the alternatives rejected (FR-001a)" });

  const red = data.redaction;
  if (red !== undefined) {
    if (!isPlainObject(red)) issues.push({ field: "redaction", message: `must be a mapping, found ${typeName(red)}` });
    else {
      if (typeof red.date !== "string" || !isCalendarDate(red.date))
        issues.push({ field: "redaction.date", message: "must be a real calendar date written YYYY-MM-DD" });
      oneLine("redaction.reason", red.reason, issues);
      if (red.fields === undefined) issues.push({ field: "redaction.fields", message: "is required" });
      else {
        stringList("redaction.fields", red.fields, issues, nonEmptyLine);
        if (Array.isArray(red.fields) && red.fields.length === 0)
          issues.push({ field: "redaction.fields", message: "must name at least one field" });
      }
    }
  }

  if (body.trim() === "") issues.push({ field: "body", message: "must say what is true and why" });

  return issues;
}

// ---------------------------------------------------------------------------------------------
// Writing

/** YAML double-quoted scalar. JSON escaping is valid YAML; a few characters JSON leaves raw are
 *  escaped too, so a file never carries an invisible or line-breaking character. */
function quote(s: string): string {
  return JSON.stringify(s).replace(
    /[\u007f-\u009f\u00ad\u2028\u2029\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const RESERVED_KEY = /^(?:true|false|null|yes|no|on|off|y|n)$/i;

function emitKey(k: string): string {
  return PLAIN_KEY.test(k) && !RESERVED_KEY.test(k) ? k : quote(k);
}

function scalar(v: unknown, field: string): string {
  if (typeof v === "string") return quote(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null) return "null";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new SerialiseError(field, `cannot be written: ${typeName(v)}`);
}

class SerialiseError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function orderedKeys(obj: Record<string, unknown>, known: string[] = []): string[] {
  const present = known.filter((k) => Object.hasOwn(obj, k) && obj[k] !== undefined);
  const extra = Object.keys(obj)
    .filter((k) => !known.includes(k) && obj[k] !== undefined)
    .sort();
  return [...present, ...extra];
}

function emitEntry(key: string, value: unknown, indent: number, out: string[], path: string, known?: string[]) {
  const pad = " ".repeat(indent);
  const k = emitKey(key);
  if (Array.isArray(value)) {
    if (value.length === 0) return void out.push(`${pad}${k}: []`);
    out.push(`${pad}${k}:`);
    value.forEach((item, i) => emitItem(item, indent + 2, out, `${path}[${i}]`));
  } else if (isPlainObject(value)) {
    const keys = orderedKeys(value, known);
    if (keys.length === 0) return void out.push(`${pad}${k}: {}`);
    out.push(`${pad}${k}:`);
    for (const kk of keys) emitEntry(kk, value[kk], indent + 2, out, `${path}.${kk}`);
  } else out.push(`${pad}${k}: ${scalar(value, path)}`);
}

function emitItem(item: unknown, indent: number, out: string[], path: string) {
  const pad = " ".repeat(indent);
  if (Array.isArray(item)) {
    if (item.length === 0) return void out.push(`${pad}- []`);
    out.push(`${pad}-`);
    item.forEach((x, i) => emitItem(x, indent + 2, out, `${path}[${i}]`));
  } else if (isPlainObject(item)) {
    const keys = orderedKeys(item);
    if (keys.length === 0) return void out.push(`${pad}- {}`);
    const sub: string[] = [];
    for (const kk of keys) emitEntry(kk, item[kk], indent + 2, sub, `${path}.${kk}`);
    sub[0] = `${pad}- ${sub[0]!.slice(indent + 2)}`;
    out.push(...sub);
  } else out.push(`${pad}- ${scalar(item, path)}`);
}

/** The canonical bytes of a record. Throws only for a value YAML cannot carry (NaN, Infinity). */
export function serialiseRecord(data: Record<string, unknown>, body: string): string {
  const out = ["---"];
  for (const key of orderedKeys(data, TOP_ORDER)) emitEntry(key, data[key], 0, out, key, NESTED_ORDER[key]);
  out.push("---");
  const text = body.trim() === "" ? "" : `\n${body.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd()}\n`;
  return out.join("\n") + "\n" + text;
}

/** Null when `text` is already in canonical form; otherwise what differs, for `lint`. */
export function canonicalIssue(text: string): Issue | null {
  const parsed = parseRecordText(text);
  if (!parsed.ok) return null; // reported as a parse failure instead
  let canonical: string;
  try {
    canonical = serialiseRecord(parsed.data, parsed.body);
  } catch (e) {
    return { field: e instanceof SerialiseError ? e.field : "(file)", message: (e as Error).message };
  }
  if (canonical === text) return null;
  const reason = text.startsWith("\uFEFF")
    ? "starts with a byte-order mark"
    : text.includes("\r")
      ? "has CR line endings"
      : "is not in canonical form (quoting, key order, indentation or spacing differs from what the writer produces)";
  return { field: "(file)", message: `${reason}; parse → re-serialise must be byte-identical (data-model §2.8)` };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** Every string in the record with its field path, body included — what the secret scan reads. */
export function stringFields(data: Record<string, unknown>, body: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") out.push([path, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isPlainObject(v)) for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k);
  };
  walk(data, "");
  out.push(["body", body]);
  return out;
}

export function secretIssues(matches: SecretMatch[]): Issue[] {
  return matches.map((m) => ({
    field: m.field,
    message: `matches the secret pattern "${m.pattern}" (${m.description}: ${m.preview}); nothing was written (FR-035)`,
  }));
}

export type Prepared = { ok: true; text: string } | { ok: false; issues: Issue[] };

/**
 * Everything that must hold before bytes are written, in order: field validation, the secret scan,
 * serialisation, and a re-parse of the serialised text that must equal what was validated
 * (data-model §2.8 rule 5). Store-level rules (id unused, `supersedes` target) are the caller's.
 */
export function prepareRecord(data: Record<string, unknown>, body: string, opts: ValidateOptions = {}): Prepared {
  const issues = validateRecord(data, body, opts);
  if (issues.length) return { ok: false, issues };
  const secrets = scanSecrets(stringFields(data, body));
  if (secrets.length) return { ok: false, issues: secretIssues(secrets) };
  let text: string;
  try {
    text = serialiseRecord(data, body);
  } catch (e) {
    const field = e instanceof SerialiseError ? e.field : "(file)";
    return { ok: false, issues: [{ field, message: (e as Error).message }] };
  }
  const back = parseRecordText(text);
  if (!back.ok || !deepEqual(back.data, data) || back.body !== body.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd())
    return {
      ok: false,
      issues: [
        {
          field: "(file)",
          message:
            "the serialised record does not read back identically — it contains a character the format " +
            "cannot carry (for example an unpaired UTF-16 surrogate); nothing was written",
        },
      ],
    };
  return { ok: true, text };
}
