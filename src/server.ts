#!/usr/bin/env bun
// Eco-MCP Gateway — v0 MCP server (stdio).
//
// Exposes token-thrifty code tools so cheap models can do real work:
//   - search_structure : code-graph symbol search (the measured ~97% token winner)
//   - find_concept     : semantic search over the graph (fuzzy/conceptual queries)
//   - retrieve         : tuned semble semantic chunks (small k) for when graph misses
//   - run_command      : run a shell command and return COMPRESSED (failures-only) output
//
// IMPORTANT: MCP stdio uses stdout for the JSON-RPC channel — all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Structural } from "./backends/structural";
import { Semantic } from "./backends/semantic";
import { compressOutput } from "./util/compress";
import { workspaceRoot } from "./util/bin";

const structural = new Structural();
const semantic = new Semantic();

const log = (...a: unknown[]) => console.error("[eco-mcp]", ...a);

const server = new McpServer({ name: "eco-mcp", version: "0.1.0" });

server.registerTool(
  "search_structure",
  {
    title: "Search code structure",
    description:
      "Find symbols (functions, classes, interfaces, methods) by name regex via the code graph. " +
      "Token-light: returns symbol metadata (file path, signature, call degree) — NOT file contents. " +
      "Use this FIRST for 'where is X defined' / 'what calls X' instead of grep + reading files.",
    inputSchema: {
      name_pattern: z.string().describe('regex over symbol names, e.g. ".*Auth.*" or "^cors$"'),
      path: z.string().optional().describe("repo path (defaults to the workspace)"),
    },
  },
  async ({ name_pattern, path }) => {
    if (!structural.available())
      return { content: [{ type: "text", text: "codebase-memory-mcp not found (set ECO_CBM_BIN)" }] };
    const text = structural.searchSymbols(path ?? workspaceRoot(), name_pattern);
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "find_concept",
  {
    title: "Find code by concept",
    description:
      "Semantic vector search over the code graph for a natural-language concept (e.g. 'where is " +
      "rate limiting handled'). Returns matching symbols + locations, token-light. Use when there's " +
      "no obvious literal keyword to search for.",
    inputSchema: {
      query: z.string().describe("natural-language description of the code you're looking for"),
      path: z.string().optional(),
    },
  },
  async ({ query, path }) => {
    if (!structural.available())
      return { content: [{ type: "text", text: "codebase-memory-mcp not found (set ECO_CBM_BIN)" }] };
    return { content: [{ type: "text", text: structural.semantic(path ?? workspaceRoot(), query) }] };
  },
);

server.registerTool(
  "retrieve",
  {
    title: "Retrieve code chunks (semantic)",
    description:
      "Tuned semantic retrieval (semble): returns the top few relevant code chunks for a query. " +
      "Prefer search_structure/find_concept for locating symbols; use this when you need to SEE the " +
      "actual code for a fuzzy concept. Kept to a small k to stay token-thrifty.",
    inputSchema: {
      query: z.string(),
      path: z.string().optional(),
      k: z.number().int().min(1).max(8).optional().describe("number of chunks (default 3)"),
    },
  },
  async ({ query, path, k }) => {
    if (!semantic.available())
      return { content: [{ type: "text", text: "semble not found (set ECO_SEMBLE_BIN or `uv tool install semble`)" }] };
    return { content: [{ type: "text", text: semantic.search(path ?? workspaceRoot(), query, k ?? 3) }] };
  },
);

server.registerTool(
  "run_command",
  {
    title: "Run command (compressed output)",
    description:
      "Run a shell command (tests, build, lint) in the workspace and return its output with noise " +
      "stripped — failures/errors/stack traces only for test runs. Cuts the tokens an agent pays to " +
      "read verbose logs. Returns a one-line savings note.",
    inputSchema: {
      command: z.string().describe("the shell command, e.g. 'bun test' or 'npm run build'"),
      cwd: z.string().optional(),
      raw: z.boolean().optional().describe("set true to skip compression"),
    },
  },
  async ({ command, cwd, raw }) => {
    const p = Bun.spawnSync(["sh", "-c", command], { cwd: cwd ?? workspaceRoot() });
    const out = `${p.stdout?.toString() ?? ""}${p.stderr?.toString() ?? ""}`;
    const c = compressOutput(out, { mode: raw ? "raw" : "auto" });
    const note =
      c.before > c.after
        ? `\n\n[eco-mcp: compressed ${c.before}→${c.after} chars, exit ${p.exitCode}]`
        : `\n\n[eco-mcp: exit ${p.exitCode}]`;
    return { content: [{ type: "text", text: (c.text || "(no output)") + note }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(
  `ready · workspace=${workspaceRoot()} · structural=${structural.available() ? "on" : "MISSING"} · semantic=${semantic.available() ? "on" : "MISSING"}`,
);
