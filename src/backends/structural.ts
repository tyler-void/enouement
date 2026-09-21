// Structural code-graph retrieval via codebase-memory-mcp's `cli` mode.
// This is the measured token winner (~97% vs reading files). Returns compact symbol metadata.

import { resolveBin, repoFallbacks } from "../util/bin";

export class Structural {
  readonly bin: string | null;
  private projectByDir = new Map<string, string>();
  constructor() {
    this.bin = resolveBin("ECO_CBM_BIN", "codebase-memory-mcp", repoFallbacks("codebase-memory-mcp"));
  }
  available(): boolean {
    return this.bin != null;
  }

  private cli(tool: string, args: Record<string, unknown>): any {
    if (!this.bin) return null;
    const p = Bun.spawnSync([this.bin, "cli", tool, JSON.stringify(args)]);
    try {
      return JSON.parse(p.stdout?.toString() ?? "");
    } catch {
      return null;
    }
  }

  private project(workdir: string): string | null {
    if (this.projectByDir.has(workdir)) return this.projectByDir.get(workdir)!;
    const res = this.cli("index_repository", { repo_path: workdir });
    const project = res?.project ?? null;
    if (project) this.projectByDir.set(workdir, project);
    return project;
  }

  /** Find symbols by name regex. Returns "name (kind) file signature [callers/callees]". */
  searchSymbols(workdir: string, namePattern: string, k = 15): string {
    const project = this.project(workdir);
    if (!project) return "structural index unavailable";
    const res = this.cli("search_graph", { project, name_pattern: namePattern });
    const results = (res?.results ?? []).slice(0, k);
    if (!results.length) return `no symbols match /${namePattern}/`;
    return results
      .map(
        (r: any) =>
          `${r.name} (${r.label}) ${r.file_path}${r.signature ?? ""}${r.return_type ?? ""}` +
          (r.in_degree || r.out_degree ? ` [in:${r.in_degree} out:${r.out_degree}]` : ""),
      )
      .join("\n");
  }

  /** All symbols with call-degree, for ranking a repo map (PageRank proxy = reference count). */
  allSymbols(workdir: string): Array<{ name: string; label: string; file: string; signature: string; inDeg: number; outDeg: number }> {
    const project = this.project(workdir);
    if (!project) return [];
    const res = this.cli("search_graph", { project, name_pattern: ".*" });
    return (res?.results ?? []).map((r: any) => ({
      name: r.name,
      label: r.label,
      file: r.file_path,
      signature: r.signature ?? "",
      inDeg: r.in_degree ?? 0,
      outDeg: r.out_degree ?? 0,
    }));
  }

  /**
   * DELIBERATELY UNWIRED (2026-07-28) — no caller. Do not re-adopt without verifying the
   * backend first. Its only caller was the `find_concept` tool, removed because
   * codebase-memory-mcp 0.7.0 silently ignores the `semantic_query` key below: it returns the
   * ENTIRE symbol table (measured: total=3529 on hono, identical for a JWT query and a nonsense
   * one), so this method just returns the first 8 rows of an unfiltered dump. The response is
   * well-formed JSON, so the try/catch in cli() reports success.
   * See docs/research/discovery-2026-07-28.md §6.1.
   *
   * Semantic vector search over the graph (codebase-memory has nomic-embed baked in).
   */
  semantic(workdir: string, query: string, k = 8): string {
    const project = this.project(workdir);
    if (!project) return "structural index unavailable";
    const res = this.cli("search_graph", { project, semantic_query: [query] });
    const results = (res?.results ?? []).slice(0, k);
    if (!results.length) return `no semantic match for "${query}"`;
    return results
      .map((r: any) => `${r.name} (${r.label}) ${r.file_path}${r.signature ?? ""}`)
      .join("\n");
  }
}
