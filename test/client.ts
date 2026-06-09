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

await client.close();
console.log("\nCLIENT OK");
process.exit(0);
