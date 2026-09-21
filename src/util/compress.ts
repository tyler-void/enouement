// DELIBERATELY UNWIRED (2026-07-28) — nothing imports this. Do not re-adopt as-is.
// Its only caller was the `run_command` tool, removed because this compressor silently
// destroys output: `looksLikeTests` below matches the bare substring "test" anywhere in the
// output (so "latest" matches too), and when the KEEP filter then matches nothing it
// substitutes the literal string "all checks passed (no failures)". Measured: `cat
// package.json` returned that string with exit 0, 484 chars of real output discarded.
// See docs/research/discovery-2026-07-28.md §6.2. Kept for reference only.
//
// Output compression — failures-only for test/build logs, with a hard size cap.
// Lossless of the diagnostic lines (keeps Expected/Received/stack), drops the noise.

const KEEP =
  /(fail|error|expect|received|assert|throw|✗|✘|panic|\d+ pass|\d+ fail|cannot find|TypeError|ReferenceError|SyntaxError|\bat\s+\/|\bat\s+\w+\s+\()/i;

export interface Compressed {
  text: string;
  before: number;
  after: number;
}

export function compressOutput(raw: string, opts: { mode?: "auto" | "raw"; maxChars?: number } = {}): Compressed {
  const before = raw.length;
  if (opts.mode === "raw") return { text: clamp(raw, opts.maxChars), before, after: raw.length };

  const lines = raw.split("\n");
  const looksLikeTests = /\d+ (pass|fail)|PASS|FAIL|✓|✗|test/i.test(raw);
  let text: string;
  if (looksLikeTests) {
    const kept = lines.filter((l) => KEEP.test(l));
    text = kept.length ? kept.join("\n") : "all checks passed (no failures)";
  } else {
    // generic: drop blank-noise, keep everything but cap
    text = lines.filter((l) => l.trim().length).join("\n");
  }
  text = clamp(text, opts.maxChars);
  return { text, before, after: text.length };
}

function clamp(s: string, maxChars = 6000): string {
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.6));
  const tail = s.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n…[eco-mcp: trimmed ${s.length - maxChars} chars]…\n${tail}`;
}
