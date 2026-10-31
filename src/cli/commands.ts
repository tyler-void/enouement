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
}

export interface PositionalDef {
  name: string;
  description: string;
  required?: boolean;
  /** Takes every remaining positional argument; the value is a list. */
  variadic?: boolean;
}

export interface CommandDef {
  name: string;
  summary: string;
  positionals: readonly PositionalDef[];
  options: readonly OptionDef[];
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
// The commands. Each later task adds its definition here (record, accept, why, view, brief, …).

export const LINT: CommandDef = {
  name: "lint",
  summary:
    "Check the knowledge store: records that do not parse or validate, non-canonical bytes, " +
    "records changed or deleted since HEAD other than by redaction, and store layout. " +
    "Exit 2 when there are findings.",
  positionals: [],
  options: [{ name: "json", type: "boolean", description: "machine-readable output" }],
};

export const COMMANDS: readonly CommandDef[] = [LINT];
