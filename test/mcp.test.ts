// CLI and MCP give the same bytes — tasks.md T055g, plan.md binding test #18.
//
// The REAL `enou` binary and the REAL MCP server over stdio, on every shared command, including an
// invalid argument and an unknown one. Two surfaces that agree only on valid input disagree exactly
// where it matters. A successful `record` is the one case that cannot be compared byte for byte —
// each call mints a new id — so its refusals are compared instead, and the success path is covered
// by test/client.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { COMMANDS } from "../src/cli/commands";
import { inputSchema, MCP_COMMANDS, toArgv } from "../src/server";
import { commitAll, front, gitInit, put, putRecord, tempRoot } from "./support/repo";

const MAIN = join(import.meta.dir, "..", "src", "cli", "main.ts");
const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const ids = Array.from({ length: 4 }, (_, i) => `01JBQ7K3M2N8P4R6T9V0W1X${"ABCD"[i]}AA`);

let root: string;
let client: Client;

beforeAll(async () => {
  root = tempRoot();
  gitInit(root);
  put(root, ".knowledge/modules.yaml", "modules:\n  - path: src\n");
  put(root, "src/a.ts", "export function aFunction() {}\n");
  put(root, "docs/x.md", "notes\n");
  putRecord(root, "records", front({ id: ids[0], kind: "invariant", summary: "a never throws", paths: ["src/a.ts"] }));
  putRecord(root, "records", front({ id: ids[1], summary: "replaced rule", paths: ["src/a.ts"], supersedes: ids[0] }));
  putRecord(root, "records", front({ id: ids[2], kind: "gotcha", summary: "declared", paths: ["src/a.ts"], symbols: ["src/a.ts#aFunction"] }));
  putRecord(root, "inbox", front({ id: ids[3], summary: "waiting draft", paths: ["src/a.ts"] }));
  commitAll(root, "fixture");
  client = new Client({ name: "enou-parity", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: "bun", args: ["run", SERVER], env: { ...process.env, ENOU_ROOT: root } as Record<string, string> }),
  );
});

afterAll(async () => {
  await client?.close();
});

function cli(argv: string[]) {
  const r = spawnSync("bun", [MAIN, ...argv], { cwd: root, encoding: "utf8", env: { ...process.env, ENOU_ROOT: undefined } });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

async function mcp(name: string, args: Record<string, unknown>) {
  const r: any = await client.callTool({ name, arguments: args });
  return { text: (r.content ?? []).map((c: any) => c.text).join(""), isError: Boolean(r.isError) };
}

const CASES: [string, Record<string, unknown>, string[]][] = [
  ["why", { target: "src/a.ts" }, ["why", "src/a.ts"]],
  ["why", { target: "src/a.ts", json: true }, ["why", "src/a.ts", "--json"]],
  ["why", { target: "src/a.ts", include_drafts: true }, ["why", "src/a.ts", "--include-drafts"]],
  ["why", { target: "aFunction" }, ["why", "aFunction"]],
  ["why", { target: "src/a.ts#aFunction" }, ["why", "src/a.ts#aFunction"]],
  ["brief", { paths: ["src/a.ts", "docs/x.md"] }, ["brief", "src/a.ts", "docs/x.md"]],
  ["brief", { paths: ["src/a.ts"], json: true, include_drafts: true }, ["brief", "src/a.ts", "--json", "--include-drafts"]],
  ["view", { module: "src" }, ["view", "src"]],
  ["view", { module: "src", json: true }, ["view", "src", "--json"]],
  ["log", { module: "src" }, ["log", "src"]],
  ["show", { id: ids[0] }, ["show", ids[0]]],
  ["show", { id: ids[3], json: true }, ["show", ids[3], "--json"]],
  ["drafts", {}, ["drafts"]],
  ["drafts", { paths: ["src/a.ts"], json: true }, ["drafts", "--paths", "src/a.ts", "--json"]],
  // invalid arguments
  ["view", { module: "nope" }, ["view", "nope"]],
  ["show", { id: "not-an-id" }, ["show", "not-an-id"]],
  ["why", { target: "?!" }, ["why", "?!"]],
  ["record", { kind: "note", summary: "s", paths: ["src/a.ts"], body: "b" }, ["record", "--kind", "note", "--summary", "s", "--paths", "src/a.ts", "--body", "b"]],
  ["record", { kind: "gotcha", summary: "x".repeat(200), paths: ["src/a.ts"], body: "b" }, ["record", "--kind", "gotcha", "--summary", "x".repeat(200), "--paths", "src/a.ts", "--body", "b"]],
  ["record", { kind: "gotcha", summary: "s", paths: ["src/a.ts"] }, ["record", "--kind", "gotcha", "--summary", "s", "--paths", "src/a.ts"]],
  ["why", {}, ["why"]],
  // unknown arguments
  ["why", { target: "src/a.ts", bogus: true }, ["why", "src/a.ts", "--bogus"]],
  ["view", { module: "src", nope: "x" }, ["view", "src", "--nope=x"]],
];

describe("CLI and MCP agree byte for byte (plan #18)", () => {
  test("every shared command is covered by at least one case", () => {
    const covered = new Set(CASES.map(([n]) => n));
    expect(MCP_COMMANDS.map((c) => c.name).filter((n) => !covered.has(n))).toEqual([]);
  });

  for (const [name, args, argv] of CASES)
    test(`${name} ${JSON.stringify(args).slice(0, 60)}`, async () => {
      const c = cli(argv);
      const m = await mcp(name, args);
      if (c.code === 0) {
        expect(m.isError).toBe(false);
        expect(m.text + "\n").toBe(c.stdout);
      } else {
        expect(m.isError).toBe(true);
        expect(m.text + "\n").toBe(c.stderr);
      }
    }, 20_000);
});

describe("the MCP surface comes from the command definitions", () => {
  test("exactly the commands marked mcp, never accept/reject/redact/lint/recall/hook", () => {
    expect(MCP_COMMANDS.map((c) => c.name).sort()).toEqual(["brief", "drafts", "log", "record", "show", "view", "why"]);
    const never = COMMANDS.filter((c) => !c.mcp).map((c) => c.name).sort();
    expect(never).toEqual(["accept", "hook", "lint", "modules", "recall", "redact", "reject"]);
  });

  test("schemas refuse unknown keys and leave out command-line-only options", () => {
    const record = MCP_COMMANDS.find((c) => c.name === "record")!;
    const schema = inputSchema(record) as { additionalProperties: boolean; properties: Record<string, unknown>; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).not.toContain("body_file");
    expect(schema.required.sort()).toEqual(["kind", "paths", "summary"]);
    expect(schema.properties.paths).toMatchObject({ type: "array", items: { type: "string" } });
  });

  test("argv keeps values that look like flags as values, and positionals after --", () => {
    const why = MCP_COMMANDS.find((c) => c.name === "why")!;
    expect(toArgv(why, { target: "--help" })).toEqual({ ok: true, argv: ["why", "--", "--help"] });
    const record = MCP_COMMANDS.find((c) => c.name === "record")!;
    expect(toArgv(record, { summary: "--x", paths: ["a", "b"] })).toEqual({ ok: true, argv: ["record", "--summary=--x", "--paths=a,b", "--"] });
    expect(toArgv(record, { paths: ["a,b"] }).ok).toBe(false);
  });
});
