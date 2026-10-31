// Smoke client for the MCP server: spawns it over stdio, lists tools, and round-trips a capture.
// Run: bun run test:client
//
// The workspace is a throwaway temp dir with an empty knowledge store, so nothing is written into
// this repository.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "enou-mcp-")));
mkdirSync(join(tmp, ".knowledge", "records"), { recursive: true });
mkdirSync(join(tmp, ".knowledge", "inbox"), { recursive: true });
mkdirSync(join(tmp, "src", "payment"), { recursive: true });
writeFileSync(join(tmp, "src", "payment", "charge.ts"), "export function charge() {}\n");

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", SERVER],
  env: { ...process.env, ENOU_ROOT: tmp } as Record<string, string>,
});

const client = new Client({ name: "enou-mcp-smoke", version: "0.2.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

// The tool list is the routing surface — assert it exactly, so a removed tool cannot silently come
// back and an excluded one cannot silently appear:
//   - find_concept / run_command removed 2026-07-28 for returning confidently wrong output
//     (docs/research/discovery-2026-07-28.md §6.1, §6.2);
//   - search_structure / retrieve / repo_map removed 2026-09-21 when the scope narrowed;
//   - get_context / update_context removed 2026-10-31: replaced by the records and their projection
//     (spec 001, Assumptions);
//   - accept / reject / redact are a person's steps and never tools (FR-044a); lint belongs to CI and
//     git hooks; recall does not exist until it is measured (FR-049); hook is for agent hooks only.
const EXPECTED = ["brief", "drafts", "log", "record", "show", "view", "why"];
const actual = tools.map((t) => t.name).sort();
const failures: string[] = [];
if (actual.length !== EXPECTED.length || EXPECTED.some((n, i) => actual[i] !== n))
  failures.push(`tool list: expected ${EXPECTED.join(", ")}; got ${actual.join(", ")}`);
else console.log(`tool list OK — exactly ${EXPECTED.length} tools`);

for (const t of tools)
  if ((t.inputSchema as { additionalProperties?: unknown }).additionalProperties !== false)
    failures.push(`${t.name}: input schema must refuse unknown arguments`);

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c: any) => c.text).join("\n");
  console.log(`\n# ${name}(${JSON.stringify(args)})${r.isError ? " [error]" : ""}\n${text.slice(0, 400)}`);
  return { text: text as string, isError: Boolean(r.isError) };
};

// Capture through MCP writes a draft, never a record.
const rec = await call("record", {
  kind: "gotcha",
  summary: "a declined card returns 402, not 400",
  paths: ["src/payment/charge.ts"],
  body: "The client retries on 400 and must not retry a decline.",
});
const id = /draft (\w{26}) written/.exec(rec.text)?.[1];
if (rec.isError || !id) failures.push("record did not write a draft");

// The draft is listed as waiting…
const drafts = await call("drafts", {});
if (!id || !drafts.text.includes(id)) failures.push("drafts does not list the new draft");

// …and is not knowledge: `why` does not present it.
const why = await call("why", { target: "src/payment/charge.ts" });
if (!why.text.includes("no recorded knowledge")) failures.push("why presented a draft as knowledge");
if (!why.text.includes("1 draft about this path is waiting")) failures.push("why did not say a draft is waiting");

// An unknown argument is refused, not silently dropped.
const unknown = await call("why", { target: "src/payment/charge.ts", bogus: true });
if (!unknown.isError || !unknown.text.includes("unknown option --bogus")) failures.push("an unknown argument was not refused");

// A command-line-only argument is not available over MCP (stdin is the protocol channel).
const cliOnly = await call("record", { kind: "gotcha", summary: "s", paths: ["a.ts"], body_file: "-" });
if (!cliOnly.isError) failures.push("body_file was accepted over MCP");

await client.close();

if (failures.length) {
  console.error(`\nCLIENT FAILED\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nCLIENT OK — tool list exact, capture is a draft, why does not serve it, unknown arguments refused");
