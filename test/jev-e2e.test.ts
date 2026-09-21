// Offline end-to-end: real MCP server over stdio, fake semble binary, fake System One endpoint.
// Proves the wiring (env → decider → retrieve → HTTP contract → formatted output + note).
// Run: bun test ./test/jev-e2e.test.ts

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "..", "src", "server.ts");
const FAKE_SEMBLE = join(import.meta.dir, "fixtures", "fake-semble.ts");

let requests: any[] = [];
let failMode = false;

// Mimics POST /v1/systemone: noul = 0.95 if the candidate lives under /cors/, else 0.08.
const jev = Bun.serve({
  port: 0,
  async fetch(req) {
    const body: any = await req.json();
    requests.push({ auth: req.headers.get("authorization"), body });
    if (failMode) return new Response("overloaded", { status: 500 });
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(body.questions)) {
      const loc: string = body.state.candidates?.[id]?.location ?? body.state.candidate.location;
      answers[id] = { type: "noul", noul: loc.includes("/cors/") ? 0.95 : 0.08 };
    }
    return Response.json({ model: body.model, answers, usage: { input_tokens: 2100, output_tokens: 0 } });
  },
});

async function retrieve(env: Record<string, string>, args: Record<string, unknown>): Promise<string> {
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", SERVER],
    env: { ...(process.env as Record<string, string>), ECO_SEMBLE_BIN: FAKE_SEMBLE, ECO_WORKSPACE: import.meta.dir, ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "jev-e2e", version: "0" });
  await client.connect(transport);
  const r: any = await client.callTool({ name: "retrieve", arguments: args });
  await client.close();
  return (r.content ?? []).map((c: any) => c.text).join("\n");
}

const ON = () => ({ ECO_JEV: "on", TYPESAFE_API_KEY: "test-key", ECO_JEV_URL: `http://localhost:${jev.port}/v1/systemone` });

beforeAll(() => {
  requests = [];
});
afterAll(() => jev.stop(true));

describe("retrieve + jev (offline)", () => {
  test("keeps only relevant chunks, annotates p, reports the filter", async () => {
    requests = [];
    const out = await retrieve(ON(), { query: "CORS middleware", k: 3 });
    expect(out).toContain("// src/middleware/cors/index.ts:1-40  (jev p=0.95)");
    expect(out).toContain("// src/middleware/cors/index.test.ts:1-20  (jev p=0.95)");
    expect(out).not.toContain("jwt");
    expect(out).toContain("[eco-mcp: jev kept 2/7 chunks (p≥0.5, shared)");
    // HTTP contract actually sent
    expect(requests).toHaveLength(1);
    expect(requests[0].auth).toBe("Bearer test-key");
    expect(requests[0].body.model).toBe("jev-1.13.0");
    expect(requests[0].body.state.query).toBe("CORS middleware");
    expect(requests[0].body.questions.c0.type).toBe("noul");
  }, 20_000);

  test("endpoint failure → unranked top-k, explicitly labelled", async () => {
    failMode = true;
    const out = await retrieve(ON(), { query: "CORS middleware", k: 3 });
    failMode = false;
    expect(out).toContain("UNRANKED semble top-3");
    expect(out).not.toContain("jev p=");
  }, 20_000);

  test("ECO_JEV unset → no network call, original behaviour", async () => {
    requests = [];
    const out = await retrieve({ TYPESAFE_API_KEY: "test-key" }, { query: "CORS middleware", k: 3 });
    expect(requests).toHaveLength(0);
    expect(out.split("\n\n")).toHaveLength(3);
    expect(out).not.toContain("[eco-mcp:");
  }, 20_000);
});
