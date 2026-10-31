#!/usr/bin/env bun
// The MCP server: a thin surface over the same command definitions as the CLI
// (contracts/cli.md, "MCP server" and "One definition per command"; tasks.md T044c).
//
// Tools are generated from `COMMANDS.filter((c) => c.mcp)` — why, brief, view, log, show, drafts,
// record. Acceptance, rejection and redaction are never tools: they are a person's steps (FR-044a).
// `lint` belongs to CI and git hooks; `recall` does not exist until it is measured.
//
// Each call is translated into the CLI's argv and run through the CLI's own `main()` in-process, so
// the one parser validates both surfaces: an unknown or malformed argument is refused with the same
// bytes the CLI prints, never silently dropped, and a successful answer is the CLI's stdout minus
// its trailing newline. The advertised input schemas are generated from the same definitions, with
// `additionalProperties: false`.
//
// The legacy Context Pack tools (get_context, update_context) are gone: authored module prose
// stopped being a source of truth when the view became a projection of records (spec.md,
// Assumptions). test/client.ts asserts the exact tool list, so neither can quietly return.
//
// MCP stdio uses stdout for the protocol — all logging goes to stderr. The server name and the
// `[eco-mcp]` log prefix stay until the spec 002 rename.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { argKey, COMMANDS, type CommandDef, type OptionDef, type PositionalDef } from "./cli/commands";
import { main } from "./cli/main";

export const MCP_COMMANDS: readonly CommandDef[] = COMMANDS.filter((c) => c.mcp);

type JsonSchema = Record<string, unknown>;

function baseSchema(o: { type?: OptionDef["type"]; values?: readonly string[]; min?: number; max?: number }): JsonSchema {
  if (o.values) return { type: "string", enum: [...o.values] };
  switch (o.type) {
    case "boolean":
      return { type: "boolean" };
    case "integer":
      return { type: "integer", ...(o.min !== undefined ? { minimum: o.min } : {}), ...(o.max !== undefined ? { maximum: o.max } : {}) };
    default:
      return { type: "string" };
  }
}

/** The tool's JSON Schema, generated from the command's single definition. */
export function inputSchema(def: CommandDef): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const p of def.positionals as PositionalDef[]) {
    const base = baseSchema({ values: p.values });
    properties[argKey(p.name)] = p.variadic
      ? { type: "array", items: base, ...(p.required ? { minItems: 1 } : {}), description: p.description }
      : { ...base, description: p.description };
    if (p.required) required.push(argKey(p.name));
  }
  for (const o of def.options) {
    if (o.cliOnly) continue;
    const base = baseSchema(o);
    properties[argKey(o.name)] =
      o.repeatable || o.commaList ? { type: "array", items: base, description: o.description } : { ...base, description: o.description };
    if (o.required) required.push(argKey(o.name));
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/**
 * Tool arguments → the CLI's argv. Options become `--name=value` (so a value starting with `--`
 * stays a value), positionals follow `--`. A key the definition does not know becomes a flag the
 * parser will refuse, exactly as on the command line. Only command-line-only options (reading a
 * file or stdin) are refused here: over MCP, stdin is the protocol channel.
 */
export function toArgv(def: CommandDef, args: Record<string, unknown>): { ok: true; argv: string[] } | { ok: false; message: string } {
  const flags: string[] = [];
  const positionals: string[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
  const consumed = new Set<string>();

  for (const p of def.positionals as PositionalDef[]) {
    const key = argKey(p.name);
    if (!(key in args)) continue;
    consumed.add(key);
    const v = args[key];
    if (p.variadic) positionals.push(...(Array.isArray(v) ? v.map(str) : [str(v)]));
    else positionals.push(str(v));
  }
  for (const [key, v] of Object.entries(args)) {
    if (consumed.has(key) || v === undefined || v === null) continue;
    const o = def.options.find((x) => argKey(x.name) === key);
    if (o?.cliOnly) return { ok: false, message: `enou ${def.name}: ${key} is a command-line-only argument; it is not available over MCP` };
    const flag = `--${o ? o.name : key.replace(/_/g, "-")}`;
    if (o?.type === "boolean" && v === true) flags.push(flag);
    else if (o?.type === "boolean" && v === false) continue;
    else if (o?.commaList && Array.isArray(v)) {
      const items = v.map(str);
      if (items.some((x) => x.includes(",")))
        return { ok: false, message: `enou ${def.name}: --${o.name} values cannot contain a comma` };
      flags.push(`${flag}=${items.join(",")}`);
    } else if (Array.isArray(v)) for (const x of v) flags.push(`${flag}=${str(x)}`);
    else if (v === true && !o) flags.push(flag);
    else flags.push(`${flag}=${str(v)}`);
  }
  return { ok: true, argv: [def.name, ...flags, "--", ...positionals] };
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** What a terminal shows for a list of `io.out`/`io.err` chunks — the CLI's own writer. */
function asWritten(chunks: string[]): string {
  return chunks.map((t) => (t.endsWith("\n") ? t : `${t}\n`)).join("");
}

/** Run one tool call through the CLI. Success: stdout without its final newline. Failure: stderr. */
export async function callTool(
  def: CommandDef,
  args: Record<string, unknown>,
  where: { cwd: string; env: Record<string, string | undefined> },
): Promise<ToolResult> {
  const t = toArgv(def, args);
  if (!t.ok) return { text: t.message, isError: true };
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(t.argv, {
    cwd: where.cwd,
    env: where.env,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    stdin: () => "", // never read the protocol channel
  });
  const stdout = asWritten(out).replace(/\n$/, "");
  const stderr = asWritten(err).replace(/\n$/, "");
  return code === 0 ? { text: stdout, isError: false } : { text: stderr || stdout, isError: true };
}

if (import.meta.main) {
  const log = (...a: unknown[]) => console.error("[eco-mcp]", ...a);
  // An agent passes repository-relative paths, so the server works from the workspace root:
  // ENOU_ROOT, else the legacy ECO_WORKSPACE, else where the server was started.
  const where = { cwd: process.env.ENOU_ROOT || process.env.ECO_WORKSPACE || process.cwd(), env: process.env };

  const server = new Server({ name: "eco-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_COMMANDS.map((def) => ({ name: def.name, description: def.summary, inputSchema: inputSchema(def) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = MCP_COMMANDS.find((c) => c.name === req.params.name);
    if (!def) return { content: [{ type: "text", text: `unknown tool ${req.params.name}` }], isError: true };
    const r = await callTool(def, (req.params.arguments ?? {}) as Record<string, unknown>, where);
    return { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) };
  });

  await server.connect(new StdioServerTransport());
  log(`ready · cwd=${where.cwd}${process.env.ENOU_ROOT ? ` · ENOU_ROOT=${process.env.ENOU_ROOT}` : ""} · tools=${MCP_COMMANDS.map((c) => c.name).join(", ")}`);
}
