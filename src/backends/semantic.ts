// Semantic retrieval via semble — TUNED per our benchmark finding: default top-k full chunks
// is NOT a token win, so we keep k small and trim each chunk. Use for fuzzy/conceptual queries
// where there's no literal keyword; prefer the structural backend for "where is X defined".

import { resolveBin, repoFallbacks } from "../util/bin";

export class Semantic {
  readonly bin: string | null;
  constructor() {
    this.bin = resolveBin("ECO_SEMBLE_BIN", "semble", repoFallbacks("semble"));
  }
  available(): boolean {
    return this.bin != null;
  }

  search(workdir: string, query: string, k = 3, maxCharsPerChunk = 600): string {
    if (!this.bin) return "semantic backend unavailable";
    const p = Bun.spawnSync([this.bin, "search", query, workdir], {
      env: { ...process.env, HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? "1" },
    });
    let parsed: any;
    try {
      parsed = JSON.parse(p.stdout?.toString() ?? "");
    } catch {
      return "semantic search failed";
    }
    const results = (parsed.results ?? []).slice(0, k);
    if (!results.length) return `no semantic match for "${query}"`;
    return results
      .map((r: any) => {
        const c = r.chunk ?? {};
        const content = String(c.content ?? "").slice(0, maxCharsPerChunk);
        return `// ${c.location ?? c.file_path}\n${content}`;
      })
      .join("\n\n");
  }
}
