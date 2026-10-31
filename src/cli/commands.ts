// One definition per command (contracts/cli.md, "One definition per command"; tasks.md T004a).
//
// A command is declared once — name, arguments, types, enums, ranges, which are repeatable — and
// that declaration is the only source for the CLI flag parser, the MCP tool's input schema (built
// from it by the server, T044c) and the validation both run. Neither surface accepts anything the
// other rejects, and an unknown argument is an error on both, never silently dropped.
//
// Plain data on purpose: no schema library here, so the core stays dependency-free and the MCP
// layer translates this into whatever its SDK wants.

export type ArgType = "string" | "boolean" | "integer" | "enum";

export interface OptionDef {
  /** Flag name without dashes, kebab-case: `include-drafts` → `--include-drafts`, key `include_drafts`. */
  name: string;
  type: ArgType;
  description: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  required?: boolean;
  /** May be given more than once; the value is a list. */
  repeatable?: boolean;
  /** A single occurrence may carry several values separated by commas. Implies a list value. */
  commaList?: boolean;
  /** Meaningful only on the command line (reading a file, stdin); left out of the MCP schema. */
  cliOnly?: boolean;
}

export interface PositionalDef {
  name: string;
  description: string;
  required?: boolean;
  /** Takes every remaining positional argument; the value is a list. */
  variadic?: boolean;
  /** When set, the value must be one of these. */
  values?: readonly string[];
}

export interface CommandDef {
  name: string;
  summary: string;
  positionals: readonly PositionalDef[];
  options: readonly OptionDef[];
  /** Exposed as an MCP tool (contracts/cli.md, MCP server). Acceptance, rejection and redaction
   *  never are: they are a person's steps (FR-044a). */
  mcp?: boolean;
}

export type ArgValue = string | number | boolean | string[];
export type Args = Record<string, ArgValue>;

export type ParseResult = { kind: "ok"; args: Args } | { kind: "help" } | { kind: "error"; message: string };

/** The key an argument has in parsed results and in an MCP tool's input: snake_case. */
export function argKey(name: string): string {
  return name.replace(/-/g, "_");
}

function convert(o: OptionDef, raw: string): { value: string | number } | { error: string } {
  const flag = `--${o.name}`;
  switch (o.type) {
    case "integer": {
      if (!/^-?\d+$/.test(raw)) return { error: `${flag} needs a whole number, got ${JSON.stringify(raw)}` };
      const n = Number(raw);
      if (o.min !== undefined && n < o.min) return { error: `${flag} must be at least ${o.min}` };
      if (o.max !== undefined && n > o.max) return { error: `${flag} must be at most ${o.max}` };
      return { value: n };
    }
    case "enum":
      return o.values?.includes(raw)
        ? { value: raw }
        : { error: `${flag} must be one of ${(o.values ?? []).join(", ")}, got ${JSON.stringify(raw)}` };
    default:
      return { value: raw };
  }
}

/** Parse argv against a definition. `--name value`, `--name=value`, bare booleans, `--` ends flags. */
export function parseArgs(def: CommandDef, argv: readonly string[]): ParseResult {
  const args: Args = {};
  const positionals: string[] = [];
  let flagsDone = false;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (flagsDone || !tok.startsWith("--") || tok === "-") {
      positionals.push(tok);
      continue;
    }
    if (tok === "--") {
      flagsDone = true;
      continue;
    }
    if (tok === "--help") return { kind: "help" };
    const eq = tok.indexOf("=");
    const name = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
    const o = def.options.find((x) => x.name === name);
    if (!o) return { kind: "error", message: `unknown option --${name}` };
    const key = argKey(o.name);
    if (o.type === "boolean") {
      if (eq >= 0) return { kind: "error", message: `--${name} takes no value` };
      args[key] = true;
      continue;
    }
    let raw: string;
    if (eq >= 0) raw = tok.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { kind: "error", message: `--${name} needs a value` };
      raw = next;
      i++;
    }
    const pieces = o.commaList ? raw.split(",") : [raw];
    const values: (string | number)[] = [];
    for (const piece of pieces) {
      const c = convert(o, piece);
      if ("error" in c) return { kind: "error", message: c.error };
      values.push(c.value);
    }
    if (o.repeatable || o.commaList) {
      const prev = (args[key] as string[] | undefined) ?? [];
      if (prev.length && !o.repeatable) return { kind: "error", message: `--${name} was given more than once` };
      args[key] = [...prev, ...(values as string[])];
    } else {
      if (key in args) return { kind: "error", message: `--${name} was given more than once` };
      args[key] = values[0]!;
    }
  }

  let p = 0;
  for (const d of def.positionals) {
    const key = argKey(d.name);
    if (d.variadic) {
      const rest = positionals.slice(p);
      p = positionals.length;
      if (rest.length) args[key] = rest;
      else if (d.required) return { kind: "error", message: `<${d.name}> is required` };
    } else if (p < positionals.length) args[key] = positionals[p++]!;
    else if (d.required) return { kind: "error", message: `<${d.name}> is required` };
    if (d.values && key in args && !d.variadic && !d.values.includes(args[key] as string))
      return { kind: "error", message: `<${d.name}> must be one of ${d.values.join(", ")}, got ${JSON.stringify(args[key])}` };
  }
  if (p < positionals.length) return { kind: "error", message: `unexpected argument ${JSON.stringify(positionals[p])}` };
  for (const o of def.options)
    if (o.required && !(argKey(o.name) in args)) return { kind: "error", message: `--${o.name} is required` };
  return { kind: "ok", args };
}

/** One-line usage plus an option table, for `--help` and for usage errors. */
export function usage(def: CommandDef): string {
  const pos = def.positionals.map((d) => {
    const n = `<${d.name}>${d.variadic ? "..." : ""}`;
    return d.required ? n : `[${n}]`;
  });
  const opts = def.options.map((o) => {
    const v = o.type === "boolean" ? "" : ` <${o.type === "enum" ? (o.values ?? []).join("|") : o.name}>`;
    const s = `--${o.name}${v}${o.repeatable ? "..." : ""}`;
    return o.required ? s : `[${s}]`;
  });
  const lines = [`usage: enou ${[def.name, ...pos, ...opts].join(" ")}`, "", def.summary];
  if (def.options.length || def.positionals.length) lines.push("");
  for (const d of def.positionals) lines.push(`  <${d.name}>`.padEnd(26) + d.description);
  for (const o of def.options) lines.push(`  --${o.name}`.padEnd(26) + o.description);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// The commands (contracts/cli.md). Declared once; the CLI parser and the MCP schemas come from here.

const JSON_OPT: OptionDef = { name: "json", type: "boolean", description: "machine-readable output" };
const DRAFTS_OPT: OptionDef = {
  name: "include-drafts",
  type: "boolean",
  description: "also show drafts, each labelled as a draft — they are not knowledge until accepted",
};

export const RECORD: CommandDef = {
  name: "record",
  summary:
    "Capture knowledge as a DRAFT in .knowledge/inbox/ (never a record). A person reads it and runs " +
    "`enou accept <id>`. Refuses, writing nothing, on a missing or over-long summary, a decision with no " +
    "rejected alternative, a bad path, or anything that looks like a secret.",
  mcp: true,
  positionals: [],
  options: [
    { name: "kind", type: "enum", values: ["decision", "invariant", "gotcha", "convention"], required: true, description: "decision | invariant | gotcha | convention" },
    { name: "summary", type: "string", required: true, description: "one line, within the summary cap — never cut for you" },
    { name: "paths", type: "string", commaList: true, required: true, description: "code paths it concerns, comma-separated; globs and dir/ allowed" },
    { name: "body", type: "string", description: "what is true and why (Markdown)" },
    { name: "body-file", type: "string", cliOnly: true, description: "read the body from a file, or - for stdin" },
    { name: "symbol", type: "string", repeatable: true, description: "a definition it concerns, as <path>#<name>" },
    { name: "rejected", type: "string", repeatable: true, description: "an alternative considered and rejected (required for a decision)" },
    { name: "supersedes", type: "string", description: "the id of the record this one replaces" },
    { name: "provenance", type: "enum", values: ["contemporaneous", "backfilled", "oral"], description: "default contemporaneous" },
    { name: "source", type: "string", description: "what it was reconstructed from, or who said it (backfilled, oral)" },
    { name: "spec", type: "string", description: "the spec that drove it" },
    { name: "commit", type: "string", repeatable: true, description: "a commit it describes (backfilled only)" },
    JSON_OPT,
  ],
};

export const DRAFTS: CommandDef = {
  name: "drafts",
  summary: "List drafts waiting for a person to accept, oldest first, with any problem that would stop acceptance.",
  mcp: true,
  positionals: [],
  options: [{ name: "paths", type: "string", commaList: true, description: "only drafts touching these paths" }, JSON_OPT],
};

export const ACCEPT: CommandDef = {
  name: "accept",
  summary:
    "Turn drafts into records: validate again (secret scan included), write canonically under the same id, " +
    "remove the draft. A person's step — never run it on an agent's behalf.",
  positionals: [{ name: "ids", description: "draft ids, in order", required: true, variadic: true }],
  options: [JSON_OPT],
};

export const REJECT: CommandDef = {
  name: "reject",
  summary: "Delete drafts. Records are never rejected — they are superseded or redacted.",
  positionals: [{ name: "ids", description: "draft ids", required: true, variadic: true }],
  options: [JSON_OPT],
};

export const SHOW: CommandDef = {
  name: "show",
  summary: "One record or draft with its computed status (current, superseded by whom, or draft) and implementing commit.",
  mcp: true,
  positionals: [{ name: "id", description: "a record or draft id", required: true }],
  options: [JSON_OPT],
};

export const WHY: CommandDef = {
  name: "why",
  summary:
    "Why is this file or symbol the way it is? The records that shaped it, oldest first, superseded ones " +
    "marked. Says so plainly when nothing is recorded; never infers a reason from the code.",
  mcp: true,
  positionals: [{ name: "target", description: "a path, a symbol name, or <path>#<name>", required: true }],
  options: [DRAFTS_OPT, JSON_OPT],
};

export const BRIEF: CommandDef = {
  name: "brief",
  summary:
    "What to know before touching these paths: the records affecting them, their modules' views, and the " +
    "gaps — uncovered paths, modules with no knowledge, drafts waiting, contradictions, dangling references.",
  mcp: true,
  positionals: [{ name: "paths", description: "paths about to be worked on", required: true, variadic: true }],
  options: [DRAFTS_OPT, JSON_OPT],
};

export const VIEW: CommandDef = {
  name: "view",
  summary: "A module's current truth: the bounded, deterministic projection of its current records, grouped by kind.",
  mcp: true,
  positionals: [{ name: "module", description: "a declared module path", required: true }],
  options: [DRAFTS_OPT, JSON_OPT],
};

export const LOG: CommandDef = {
  name: "log",
  summary: "A module's full log: every record, superseded ones marked. Rendered on demand, never stored.",
  mcp: true,
  positionals: [{ name: "module", description: "a declared module path", required: true }],
  options: [DRAFTS_OPT, JSON_OPT],
};

export const REDACT: CommandDef = {
  name: "redact",
  summary:
    "Replace sensitive content in a record — the one permitted change to a record. The original stays in git " +
    "history; a credential must be rotated. A person's step.",
  positionals: [{ name: "id", description: "the record id", required: true }],
  options: [
    { name: "reason", type: "string", required: true, description: "why it is being redacted" },
    { name: "fields", type: "string", commaList: true, required: true, description: "summary, body, rejected, provenance.source" },
    JSON_OPT,
  ],
};

export const LINT: CommandDef = {
  name: "lint",
  summary:
    "Check the knowledge store and the change: records that do not parse or validate, non-canonical bytes, " +
    "records edited other than by redaction, modules changed with no knowledge, dangling references. " +
    "Exit 2 when there are findings.",
  positionals: [],
  options: [
    { name: "staged", type: "boolean", description: "check the staged change (pre-commit)" },
    { name: "range", type: "string", description: "check the commits in <a>..<b> (pre-push, CI)" },
    JSON_OPT,
  ],
};

export const MODULES: CommandDef = {
  name: "modules",
  summary: "Module declarations: list them, show tracked paths no module covers, or add / move / remove one.",
  positionals: [
    { name: "action", description: "list | uncovered | add | move | remove", required: true, values: ["list", "uncovered", "add", "move", "remove"] },
    { name: "args", description: "add <path> · move <from> <to> · remove <path>", variadic: true },
  ],
  options: [JSON_OPT],
};

export const RECALL: CommandDef = {
  name: "recall",
  summary: "Free-text search over records. Not implemented: it ships only after a ranker clears its measured bar.",
  positionals: [{ name: "query", description: "free text", required: true, variadic: true }],
  options: [JSON_OPT],
};

export const HOOK: CommandDef = {
  name: "hook",
  summary: "Entry point for agent hooks (Claude Code). Reads the hook's JSON on stdin; never blocks the agent.",
  positionals: [
    { name: "event", description: "post-read | session-start | session-end", required: true, values: ["post-read", "session-start", "session-end"] },
  ],
  options: [],
};

export const COMMANDS: readonly CommandDef[] = [
  RECORD, DRAFTS, ACCEPT, REJECT, WHY, BRIEF, VIEW, LOG, SHOW, REDACT, LINT, MODULES, RECALL, HOOK,
];
