#!/usr/bin/env bun
// Eco-MCP Gateway — v0 MCP server (stdio).
//
// Exposes token-thrifty code tools so cheap models can do real work:
//   - search_structure : code-graph symbol search (the measured ~97% token winner)
//   - retrieve         : tuned semble semantic chunks (small k) for when graph misses
//                        (optional: ECO_JEV=on filters chunks by relevance — see src/decide/)
//
// Removed 2026-07-28: `find_concept` and `run_command` — both returned confidently wrong
// output. See docs/research/discovery-2026-07-28.md §6.1 and §6.2.
//
// IMPORTANT: MCP stdio uses stdout for the JSON-RPC channel — all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Structural } from "./backends/structural";
import { Semantic, formatChunks } from "./backends/semantic";
import { workspaceRoot } from "./util/bin";
import { findContextPacks, writeContextPack } from "./util/context";
import { deciderFromEnv } from "./decide/jev";
import { DEFAULT_RERANK, outcomeNote, rerankChunks, type RerankOpts } from "./decide/rerank";

const structural = new Structural();
const semantic = new Semantic();

// Optional Jev relevance filter for `retrieve` — off unless ECO_JEV=on (see src/decide/jev.ts).
const decider = deciderFromEnv();
const rerankPool = Number(process.env.ECO_JEV_POOL ?? 12);
const rerankOpts: RerankOpts = {
  ...DEFAULT_RERANK,
  threshold: Number(process.env.ECO_JEV_THRESHOLD ?? DEFAULT_RERANK.threshold),
  mode: process.env.ECO_JEV_MODE === "pair" ? "pair" : "shared",
};

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
  "retrieve",
  {
    title: "Retrieve code chunks (semantic)",
    description:
      "Tuned semantic retrieval (semble): returns the top few relevant code chunks for a query. " +
      "Prefer search_structure for locating symbols; use this when you need to SEE the " +
      "actual code for a fuzzy concept. Kept to a small k to stay token-thrifty." +
      (decider
        ? " Relevance-filtered: returns only chunks judged relevant (up to k), possibly fewer; " +
          "a trailing [eco-mcp: …] line reports how many were kept."
        : ""),
    inputSchema: {
      query: z.string(),
      path: z.string().optional(),
      k: z.number().int().min(1).max(8).optional().describe(decider ? "max chunks (default 3)" : "number of chunks (default 3)"),
    },
  },
  async ({ query, path, k }) => {
    if (!semantic.available())
      return { content: [{ type: "text", text: "semble not found (set ECO_SEMBLE_BIN or `uv tool install semble`)" }] };
    const root = path ?? workspaceRoot();
    const want = k ?? 3;
    if (!decider) return { content: [{ type: "text", text: semantic.search(root, query, want) }] };

    const pool = semantic.searchRaw(root, query, Math.max(rerankPool, want));
    if (pool == null) return { content: [{ type: "text", text: "semantic search failed" }] };
    if (!pool.length) return { content: [{ type: "text", text: `no semantic match for "${query}"` }] };
    const o = await rerankChunks(query, pool, decider, { ...rerankOpts, k: want });
    log(outcomeNote(o, rerankOpts.threshold));
    const body = formatChunks(
      o.kept.map((r) => r.chunk),
      (i) => (o.kept[i]!.p == null ? "" : `  (jev p=${o.kept[i]!.p!.toFixed(2)})`),
    );
    return { content: [{ type: "text", text: `${body}\n\n${outcomeNote(o, rerankOpts.threshold)}` }] };
  },
);

// --- CCI / Context Packs --------------------------------------------------

server.registerTool(
  "repo_map",
  {
    title: "Compact repo map",
    description:
      "A token-budgeted map of the most IMPORTANT symbols in the repo, ranked by how many things " +
      "reference them (call in-degree — a PageRank proxy). Read this FIRST to orient in an unfamiliar " +
      "codebase instead of listing/reading files. Returns symbol + file + signature, grouped by file.",
    inputSchema: {
      path: z.string().optional(),
      limit: z.number().int().min(10).max(200).optional().describe("max symbols (default 60)"),
    },
  },
  async ({ path, limit }) => {
    if (!structural.available())
      return { content: [{ type: "text", text: "codebase-memory-mcp not found (set ECO_CBM_BIN)" }] };
    const SKIP = new Set(["Route", "Folder", "File", "Module"]); // keep real code defs (incl. #private)
    const syms = structural
      .allSymbols(path ?? workspaceRoot())
      .filter((s) => s.name && !SKIP.has(s.label))
      .sort((a, b) => b.inDeg + b.outDeg - (a.inDeg + a.outDeg))
      .slice(0, limit ?? 60);
    if (!syms.length) return { content: [{ type: "text", text: "no symbols indexed" }] };
    const byFile = new Map<string, string[]>();
    for (const s of syms) {
      const line = `  ${s.name} (${s.label})${s.signature}  [refs:${s.inDeg}]`;
      (byFile.get(s.file) ?? byFile.set(s.file, []).get(s.file)!).push(line);
    }
    const text = [`# Repo map — top ${syms.length} symbols by reference count`, ...[...byFile].map(([f, ls]) => `\n${f}\n${ls.join("\n")}`)].join("\n");
    return { content: [{ type: "text", text }] };
  },
);

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
log(
  `ready · workspace=${workspaceRoot()} · structural=${structural.available() ? "on" : "MISSING"} · semantic=${semantic.available() ? "on" : "MISSING"} · jev-rerank=${decider ? `on (${decider.id}, pool ${rerankPool}, p≥${rerankOpts.threshold}, ${rerankOpts.mode})` : "off"}`,
);
