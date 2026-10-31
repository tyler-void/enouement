// Capture-time secret scan (FR-035, research.md §6).
//
// Deterministic, offline, regex only: no model, no network, no entropy heuristic that fires on
// base64 data. A false positive blocks one capture and is cheap; a false negative can be committed
// by an auto-commit hook before anyone reads it. The set is high-signal shapes only, so it reduces
// the likeliest path in without claiming to close the class — redaction (FR-033) is downstream.

export interface SecretPattern {
  id: string;
  description: string;
  regex: RegExp;
}

/** Bumped whenever a pattern is added, removed or changed. Every pattern carries the g flag:
 *  the scan walks all matches, so a placeholder earlier in a text cannot hide a secret later. */
export const SECRET_PATTERNS_VERSION = 1;

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: "private-key",
    description: "a private key block header",
    regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: "aws-access-key-id",
    description: "an AWS access key id",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "github-token",
    description: "a GitHub token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  {
    id: "slack-token",
    description: "a Slack token",
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  },
  {
    id: "bearer-token",
    description: "a bearer or authorization credential",
    regex:
      /(?:\bbearer\s+|\bauthorization\s*[:=]\s*["']?(?:bearer\s+|basic\s+|token\s+)?)(?<value>[A-Za-z0-9\-._~+/$]{20,}=*)/gi,
  },
  {
    id: "api-key-assignment",
    description: "a key, token, secret or password assigned a literal value",
    regex:
      /\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|access[_-]?key)\s*[:=]\s*["']?(?<value>[^\s"'<>]{16,})/gi,
  },
];

/**
 * A captured value that is a placeholder (`${TOKEN}`, `$TOKEN`, `xxxxxxxx…`), a reference to the
 * environment (`process.env.X`, `os.environ[…]`, `getenv(…)`), or the bare NAME of a variable
 * (`GITHUB_TOKEN`) is not a secret. Records explain configuration, and refusing every one that
 * says where a token comes from would make the scan a nuisance rather than a guard. The name test
 * is case-sensitive on purpose: a lower-case run of letters and digits is what a real token is.
 */
export function isPlaceholder(value: string): boolean {
  return (
    /^[<$]/.test(value) ||
    /^x{8,}$/i.test(value) ||
    /^(?:process\.env|os\.environ|getenv|ENV\[|env\.)/.test(value) ||
    /^[A-Z][A-Z0-9_]*$/.test(value)
  );
}

export interface SecretMatch {
  field: string;
  pattern: string;
  description: string;
  /** The first and last few characters only — the match itself is never echoed in full. */
  preview: string;
}

function preview(s: string): string {
  return s.length <= 8 ? "…" : `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/** Scan every string value in `fields` (field path → text). Returns one match per field and pattern. */
export function scanSecrets(fields: Iterable<[string, string]>): SecretMatch[] {
  const out: SecretMatch[] = [];
  for (const [field, text] of fields) {
    for (const p of SECRET_PATTERNS) {
      for (const m of text.matchAll(p.regex)) {
        const value = m.groups?.value;
        if (value !== undefined && isPlaceholder(value)) continue;
        out.push({ field, pattern: p.id, description: p.description, preview: preview(m[0]) });
        break;
      }
    }
  }
  return out;
}
