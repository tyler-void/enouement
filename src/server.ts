#!/usr/bin/env bun
// Eco-MCP — project memory over MCP (stdio).
//
// Scope narrowed 2026-09-21 to Continuous Context Integration (CCI) — the one thing no
// other tool does for us:
//   - get_context    : read the module's living Context Pack(s) from .context/*.md
//   - update_context : write distilled domain knowledge back, in-repo, reviewed in the PR
//
// Retrieval (search_structure, retrieve, repo_map) was removed: codebase-memory-mcp, semble
// and rtk each ship their own MCP server, skills and hooks now, so wrapping them added
// nothing. The Jev rerank work lives on as a research experiment in bench/.
// Removed 2026-07-28: `find_concept` and `run_command` — both returned confidently wrong
// output. See docs/research/discovery-2026-07-28.md §6.1 and §6.2.
//
// IMPORTANT: MCP stdio uses stdout for the JSON-RPC channel — all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { workspaceRoot } from "./util/bin";
import { findContextPacks, writeContextPack } from "./util/context";

const log = (...a: unknown[]) => console.error("[eco-mcp]", ...a);

const server = new McpServer({ name: "eco-mcp", version: "0.1.0" });

// --- CCI / Context Packs --------------------------------------------------

server.registerTool(
  "get_context",
  {
    title: "Get Context Pack",
    description:
      "Read the module's living Context Pack(s) — distilled domain knowledge stored in .context/*.md " +
      "alongside the code (business rules, gotchas, architecture). Read this BEFORE diving into a " +
      "module: it's the digested knowledge a teammate would give you, at a fraction of the tokens of " +
      "reading the source. Layered: module-specific first, broader context after.",
    inputSchema: { path: z.string().optional().describe("file or dir you're about to work on") },
  },
  async ({ path }) => {
    const packs = findContextPacks(workspaceRoot(), path ?? ".");
    if (!packs.length)
      return {
        content: [
          {
            type: "text",
            text: "No Context Pack yet for this path. After you finish work here, call update_context to capture the domain knowledge for the next agent.",
          },
        ],
      };
    const text = packs.map((p) => `===== ${p.path} =====\n${p.content}`).join("\n\n");
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "update_context",
  {
    title: "Update Context Pack",
    description:
      "Persist distilled domain knowledge to <module>/.context/domain_logic.md (Continuous Context " +
      "Integration). Call this AFTER completing a task: summarize the business logic, key decisions, " +
      "and gotchas you learned (NOT a code dump) so the next agent reads 1k tokens instead of the " +
      "whole module. The file is staged into the PR for review. Append by default.",
    inputSchema: {
      module: z.string().describe("the module dir this knowledge belongs to, e.g. src/modules/payment"),
      content: z.string().describe("concise markdown: domain logic, decisions, edge cases, gotchas"),
      file: z.string().optional().describe("default domain_logic.md"),
      mode: z.enum(["append", "replace"]).optional(),
    },
  },
  async ({ module, content, file, mode }) => {
    const rel = writeContextPack(workspaceRoot(), module, content, { file, mode });
    return { content: [{ type: "text", text: `Context Pack updated: ${rel} (stage it in your PR for review).` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready · workspace=${workspaceRoot()} · tools=get_context, update_context`);
