// Smoke client for the eco-mcp server: spawns it over stdio, lists tools, calls each.
// Run: bun run test:client
//
// Workspace is a throwaway temp dir — the server's whole surface is project memory, so it
// needs no indexed fixture repo, and a temp dir keeps the CCI write out of this repo.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const tmp = mkdtempSync(join(tmpdir(), "eco-cci-"));

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", SERVER],
  env: { ...process.env, ECO_WORKSPACE: tmp },
});

const client = new Client({ name: "eco-mcp-smoke", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

// The tool list is the routing surface — assert it exactly, so a tool removed for returning
// wrong answers cannot silently come back. find_concept/run_command removed 2026-07-28
// (docs/research/discovery-2026-07-28.md §6.1, §6.2); search_structure/retrieve/repo_map
// removed 2026-09-21 when the scope narrowed to project memory.
const EXPECTED = ["get_context", "update_context"];
const actual = tools.map((t) => t.name).sort();
if (actual.length !== EXPECTED.length || EXPECTED.some((n, i) => actual[i] !== n)) {
  console.error(`\nTOOL LIST MISMATCH\n  expected: ${EXPECTED.join(", ")}\n  actual:   ${actual.join(", ")}`);
  process.exit(1);
}
console.log(`tool list OK — exactly ${EXPECTED.length} tools`);

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c: any) => c.text).join("\n");
  console.log(`\n# ${name}(${JSON.stringify(args)})\n${text.slice(0, 400)}`);
  return text as string;
};

// Empty workspace: get_context must say so rather than invent a pack.
const empty = await call("get_context", { path: "src/payment/charge.ts" });
const emptyOK = empty.includes("No Context Pack yet");

// CCI round-trip: write a Context Pack, then read it back through get_context.
await call("update_context", {
  module: "src/payment",
  content: "# Payment\n- Auth happens in processPayment().\n- Returns 402 on declined card.",
});
const back = await call("get_context", { path: "src/payment/charge.ts" });
const ok = back.includes("processPayment");

await client.close();

console.log(
  `\nCLIENT OK${emptyOK ? "" : " — EMPTY-WORKSPACE CHECK FAILED"}${ok ? " — CCI round-trip verified" : " — CCI ROUND-TRIP FAILED"}`,
);
process.exit(ok && emptyOK ? 0 : 1);
