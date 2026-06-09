// Smoke client for the eco-mcp server: spawns it over stdio, lists tools, calls each.
// Run: bun run test:client

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const HONO = join(import.meta.dir, "..", "bench", "fixtures", "oss", "hono");

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", join(import.meta.dir, "..", "src", "server.ts")],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`, ECO_WORKSPACE: HONO },
});

const client = new Client({ name: "eco-mcp-smoke", version: "0.1.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = (r.content ?? []).map((c: any) => c.text).join("\n");
  console.log(`\n# ${name}(${JSON.stringify(args)})\n${text.slice(0, 400)}`);
};

await call("search_structure", { name_pattern: "^cors$" });
await call("find_concept", { query: "verify a JSON web token" });
await call("run_command", { command: "echo INFO starting && echo 'FAIL: boom' && echo done", cwd: HONO });
await call("repo_map", { limit: 12 });
await call("get_context", { path: "src/middleware/cors" });

await client.close();

// CCI round-trip in a throwaway workspace: write a Context Pack, then read it back.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const tmp = mkdtempSync(join(tmpdir(), "eco-cci-"));
const t2 = new StdioClientTransport({
  command: "bun",
  args: ["run", join(import.meta.dir, "..", "src", "server.ts")],
  env: { ...process.env, ECO_WORKSPACE: tmp },
});
const c2 = new Client({ name: "eco-cci-smoke", version: "0.1.0" });
await c2.connect(t2);
const w: any = await c2.callTool({
  name: "update_context",
  arguments: { module: "src/payment", content: "# Payment\n- Auth happens in processPayment().\n- Returns 402 on declined card." },
});
console.log("\n# update_context\n" + w.content[0].text);
const r: any = await c2.callTool({ name: "get_context", arguments: { path: "src/payment/charge.ts" } });
const back = r.content[0].text;
console.log("# get_context (round-trip)\n" + back.slice(0, 200));
const ok = back.includes("processPayment");
await c2.close();

console.log(`\nCLIENT OK${ok ? " — CCI round-trip verified" : " — CCI ROUND-TRIP FAILED"}`);
process.exit(ok ? 0 : 1);
