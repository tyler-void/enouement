// Retrieval backends — the real production token-savers wired behind the gateway facade.
//
// - SembleBackend       : real semantic search (semble CLI: Model2Vec + BM25).  -> `retrieve`
// - CodebaseMemoryBackend: real structural search (codebase-memory-mcp CLI graph). -> `query_structure`
// - BuiltinBackend       : keyword fallback when neither binary is present.
//
// All return COMPACT text (locations + signatures), not whole files — that compactness IS
// the token-saving lever the benchmark measures.

import { existsSync } from "node:fs";
import { join } from "node:path";

function which(bin: string): string | null {
  const p = Bun.spawnSync(["sh", "-c", `command -v ${bin} || true`]);
  const out = p.stdout?.toString().trim();
  return out || null;
}

// --- semble (semantic) -----------------------------------------------------

export class SembleBackend {
  readonly id = "semble";
  private bin: string | null;
  constructor() {
    this.bin =
      process.env.SEMBLE_BIN ||
      which("semble") ||
      (existsSync(`${process.env.HOME}/.local/bin/semble`)
        ? `${process.env.HOME}/.local/bin/semble`
        : null);
  }
  available(): boolean {
    return this.bin != null;
  }
  /**
   * Semantic search → top-K retrieved chunks (location + the ACTUAL chunk content semble
   * surfaces). This is the real retrieved context a production MCP would inject — NOT a
   * one-line signature. Returning the real chunk keeps the benchmark a fair whole-file-vs-chunk
   * comparison (the audit flagged the old signature-only version as a rigged locator-vs-document
   * comparison). Each chunk is capped to avoid a pathological huge chunk dominating.
   */
  search(query: string, workdir: string, k = 5, maxCharsPerChunk = 1200): string {
    if (!this.bin) return "";
    const p = Bun.spawnSync([this.bin, "search", query, workdir], {
      env: { ...process.env, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? "1" },
    });
    const raw = p.stdout?.toString() ?? "";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return "";
    }
    const results = (parsed.results ?? []).slice(0, k);
    return results
      .map((r: any) => {
        const c = r.chunk ?? {};
        const content = String(c.content ?? "").slice(0, maxCharsPerChunk);
        return `// ${c.location ?? c.file_path}\n${content}`;
      })
      .join("\n\n");
  }
}

// --- codebase-memory (structural) ------------------------------------------

export class CodebaseMemoryBackend {
  readonly id = "codebase-memory";
  private bin: string | null;
  private projectByDir = new Map<string, string>();
  constructor(toolsDir: string) {
    const local = join(toolsDir, "codebase-memory-mcp");
    this.bin = process.env.CBM_BIN || (existsSync(local) ? local : which("codebase-memory-mcp"));
  }
  available(): boolean {
    return this.bin != null;
  }
  private cli(args: Record<string, unknown>, tool: string): any {
    if (!this.bin) return null;
    const p = Bun.spawnSync([this.bin, "cli", tool, JSON.stringify(args)]);
    const raw = p.stdout?.toString() ?? "";
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  private ensureIndexed(workdir: string): string | null {
    if (this.projectByDir.has(workdir)) return this.projectByDir.get(workdir)!;
    const res = this.cli({ repo_path: workdir }, "index_repository");
    const project = res?.project;
    if (project) this.projectByDir.set(workdir, project);
    return project ?? null;
  }
  /** Structural symbol search by name pattern → compact "name (label) file signature". */
  search(namePattern: string, workdir: string, k = 10): string {
    const project = this.ensureIndexed(workdir);
    if (!project) return "";
    const res = this.cli({ project, name_pattern: namePattern }, "search_graph");
    const results = (res?.results ?? []).slice(0, k);
    return results
      .map(
        (r: any) =>
          `${r.name} (${r.label}) ${r.file_path}${r.signature ?? ""}${r.return_type ?? ""}` +
          (r.in_degree || r.out_degree ? ` [in:${r.in_degree} out:${r.out_degree}]` : ""),
      )
      .join("\n");
  }
}

// --- builtin fallback (keyword) --------------------------------------------
// Re-implemented compactly here so tools.ts can delegate uniformly.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";

function listFiles(workdir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|js|tsx|jsx)$/.test(e)) out.push(p);
    }
  };
  walk(workdir);
  return out;
}

export class BuiltinBackend {
  readonly id = "builtin";
  available(): boolean {
    return true;
  }
  search(query: string, workdir: string, k = 8): string {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2);
    type Hit = { loc: string; text: string; score: number };
    const hits: Hit[] = [];
    for (const f of listFiles(workdir)) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        let score = 0;
        const lower = l.toLowerCase();
        for (const t of terms) if (lower.includes(t)) score++;
        if (/\b(function|export|class|const|interface)\b/.test(l)) score += 0.5;
        if (score > 0)
          hits.push({ loc: `${relative(workdir, f)}:${i + 1}`, text: l.trim(), score });
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits
      .slice(0, k)
      .map((h) => `${h.loc}: ${h.text}`)
      .join("\n");
  }
}

// --- selection -------------------------------------------------------------

export interface Backends {
  semantic: SembleBackend | BuiltinBackend;
  semanticId: string;
  structural: CodebaseMemoryBackend | null;
}

export function selectBackends(toolsDir: string): Backends {
  const semble = new SembleBackend();
  const cbm = new CodebaseMemoryBackend(toolsDir);
  return {
    semantic: semble.available() ? semble : new BuiltinBackend(),
    semanticId: semble.available() ? "semble" : "builtin",
    structural: cbm.available() ? cbm : null,
  };
}
