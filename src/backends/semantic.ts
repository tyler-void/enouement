// Semantic retrieval via semble — TUNED per our benchmark finding: default top-k full chunks
// is NOT a token win, so we keep k small and trim each chunk. Use for fuzzy/conceptual queries
// where there's no literal keyword; prefer the structural backend for "where is X defined".

import { resolveBin, repoFallbacks } from "../util/bin";

export interface Chunk {
  location: string;
  content: string;
}

/**
 * semble has shipped two JSON shapes:
 *   <= 0.3.x : results[] = { chunk: { file_path, start_line, end_line, content, location }, score }
 *   >= 0.4.0 : results[] = { file_path, start_line, end_line, score, content }   (flat)
 * Reading only the old shape turns every chunk into "// undefined" with empty content on a
 * current install, so accept both.
 */
export function parseSembleResults(stdout: string, maxCharsPerChunk: number): Chunk[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  return (parsed?.results ?? []).map((r: any) => {
    const c = r?.chunk ?? r ?? {};
    const range = c.start_line != null ? `:${c.start_line}-${c.end_line}` : "";
    return {
      location: String(c.location ?? `${c.file_path}${range}`),
      content: String(c.content ?? "").slice(0, maxCharsPerChunk),
    };
  });
}

export function formatChunks(chunks: Chunk[], annotate?: (i: number) => string): string {
  return chunks.map((c, i) => `// ${c.location}${annotate ? annotate(i) : ""}\n${c.content}`).join("\n\n");
}

export class Semantic {
  readonly bin: string | null;
  constructor() {
    this.bin = resolveBin("ECO_SEMBLE_BIN", "semble", repoFallbacks("semble"));
  }
  available(): boolean {
    return this.bin != null;
  }

  /** Top-k chunks as data. `-k` is passed through: semble defaults to 5 and ignores a larger slice. */
  searchRaw(workdir: string, query: string, k = 3, maxCharsPerChunk = 600): Chunk[] | null {
    if (!this.bin) return null;
    const p = Bun.spawnSync([this.bin, "search", query, workdir, "-k", String(k)], {
      env: { ...process.env, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? "1" },
    });
    const chunks = parseSembleResults(p.stdout?.toString() ?? "", maxCharsPerChunk);
    return chunks ? chunks.slice(0, k) : null;
  }

  search(workdir: string, query: string, k = 3, maxCharsPerChunk = 600): string {
    if (!this.bin) return "semantic backend unavailable";
    const chunks = this.searchRaw(workdir, query, k, maxCharsPerChunk);
    if (chunks == null) return "semantic search failed";
    if (!chunks.length) return `no semantic match for "${query}"`;
    return formatChunks(chunks);
  }
}
