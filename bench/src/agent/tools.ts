// Agent tools, operating on a per-run working directory.
//
// Baseline tools (A0) are deliberately token-hungry — read_file returns whole files, grep
// returns raw matches across the repo. The gateway variants (retrieval, compressed test
// output) are the levers we measure: same job, far fewer tokens.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import type { Profile, ToolCall, ToolDef } from "../types";
import type { Backends } from "./backends";

export interface ToolContext {
  workdir: string;
}

interface ToolImpl {
  def: ToolDef;
  run: (args: Record<string, unknown>, ctx: ToolContext) => string;
}

// --- helpers ---------------------------------------------------------------

function listSourceFiles(workdir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (e === "node_modules" || e.startsWith(".")) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|js|tsx|jsx|json|md)$/.test(e)) out.push(p);
    }
  };
  walk(workdir);
  return out;
}

function rel(workdir: string, p: string) {
  return relative(workdir, p) || p;
}

// --- baseline tools --------------------------------------------------------

const listDir: ToolImpl = {
  def: {
    name: "list_dir",
    description: "List the repository's source and test files (relative paths).",
    parameters: { properties: {}, required: [] },
  },
  run: (_args, ctx) =>
    listSourceFiles(ctx.workdir)
      .map((p) => rel(ctx.workdir, p))
      .join("\n"),
};

const readFile: ToolImpl = {
  def: {
    name: "read_file",
    description: "Read the FULL contents of a file by relative path.",
    parameters: {
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  run: (args, ctx) => {
    const p = join(ctx.workdir, String(args.path));
    try {
      const lines = readFileSync(p, "utf8").split("\n");
      return lines.map((l, i) => `${i + 1}\t${l}`).join("\n");
    } catch (e) {
      return `ERROR: cannot read ${args.path}: ${(e as Error).message}`;
    }
  },
};

const grep: ToolImpl = {
  def: {
    name: "grep",
    description:
      "Search all files for a substring. Returns every matching line across the repo (raw).",
    parameters: {
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  run: (args, ctx) => {
    const pat = String(args.pattern);
    const hits: string[] = [];
    for (const f of listSourceFiles(ctx.workdir)) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (l.includes(pat)) hits.push(`${rel(ctx.workdir, f)}:${i + 1}: ${l}`);
      });
    }
    return hits.length ? hits.join("\n") : `no matches for "${pat}"`;
  },
};

// --- gateway variant: real retrieval backends ------------------------------
// Delegates to the production token-savers (semble / codebase-memory) when present, with a
// builtin keyword fallback. Returns compact locations + signatures, not whole files.

function makeRetrieve(backends: Backends): ToolImpl {
  return {
    def: {
      name: "retrieve",
      description: `Semantic code search (backend: ${backends.semanticId}). Returns the most relevant code locations + signatures for a natural-language or keyword query. Use this INSTEAD of reading whole files.`,
      parameters: { properties: { query: { type: "string" } }, required: ["query"] },
    },
    run: (args, ctx) => {
      const out = backends.semantic.search(String(args.query), ctx.workdir);
      return out || `no relevant code for "${args.query}"`;
    },
  };
}

function makeQueryStructure(backends: Backends): ToolImpl {
  return {
    def: {
      name: "query_structure",
      description:
        'Structural symbol search over the code graph. Pass a regex `name_pattern` (e.g. ".*Tax.*"). Returns matching symbols with file, signature, and call degree — token-light vs reading files.',
      parameters: { properties: { name_pattern: { type: "string" } }, required: ["name_pattern"] },
    },
    run: (args, ctx) => {
      if (!backends.structural) return "structural backend unavailable";
      const out = backends.structural.search(String(args.name_pattern), ctx.workdir);
      return out || `no symbols match ${args.name_pattern}`;
    },
  };
}

// --- write / edit ----------------------------------------------------------

const writeFile: ToolImpl = {
  def: {
    name: "write_file",
    description: "Create or overwrite a file with the given full contents.",
    parameters: {
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  run: (args, ctx) => {
    const p = join(ctx.workdir, String(args.path));
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, String(args.content), "utf8");
      return `wrote ${args.path}`;
    } catch (e) {
      return `ERROR writing ${args.path}: ${(e as Error).message}`;
    }
  },
};

// --- run tests -------------------------------------------------------------

function compressTestOutput(raw: string): string {
  // rtk-style: keep only failures, errors, expectations, and the summary line.
  const keep = raw
    .split("\n")
    .filter((l) =>
      /(fail|error|expect|throw|✗|✘|\bnot\b|\d+ pass|\d+ fail|cannot find|TypeError|ReferenceError)/i.test(
        l,
      ),
    );
  return keep.length ? keep.join("\n") : "all tests passed";
}

function makeRunTests(compress: boolean): ToolImpl {
  return {
    def: {
      name: "run_tests",
      description:
        "Run the test suite (optionally a single test file path). Returns the test runner output.",
      parameters: {
        properties: { file: { type: "string" } },
        required: [],
      },
    },
    run: (args, ctx) => {
      const file = args.file ? [String(args.file)] : [];
      const proc = Bun.spawnSync(["bun", "test", ...file], { cwd: ctx.workdir });
      const raw = `${proc.stdout?.toString() ?? ""}${proc.stderr?.toString() ?? ""}`.trim();
      return compress ? compressTestOutput(raw) : raw || "(no output)";
    },
  };
}

const finish: ToolImpl = {
  def: {
    name: "finish",
    description: "Call when the task is complete. Provide your final answer / summary.",
    parameters: {
      properties: { answer: { type: "string" } },
      required: ["answer"],
    },
  },
  run: (args) => String(args.answer ?? ""),
};

// --- registry --------------------------------------------------------------

export interface ToolKit {
  defs: ToolDef[];
  run: (call: ToolCall, ctx: ToolContext) => string;
  isFinish: (name: string) => boolean;
}

export function buildToolKit(profile: Profile, backends: Backends): ToolKit {
  const impls: ToolImpl[] = [listDir];

  if (profile.retrieval) {
    impls.push(makeRetrieve(backends), readFile); // retrieval-first, read_file for detail
    if (backends.structural) impls.push(makeQueryStructure(backends));
  } else {
    impls.push(grep, readFile);
  }

  impls.push(writeFile, makeRunTests(profile.compressOutput), finish);

  const byName = new Map(impls.map((i) => [i.def.name, i]));
  return {
    defs: impls.map((i) => i.def),
    run: (call, ctx) => {
      const impl = byName.get(call.name);
      if (!impl) return `ERROR: unknown tool ${call.name}`;
      return impl.run(call.args, ctx);
    },
    isFinish: (name) => name === "finish",
  };
}
