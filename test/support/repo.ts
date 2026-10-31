// Throwaway repositories for the knowledge tests. Everything is created under the OS temp
// directory, never inside this repository.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serialiseRecord } from "../../src/knowledge/record";

export function tempRoot(withStore = true): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "enou-test-")));
  if (withStore) {
    mkdirSync(join(root, ".knowledge", "records"), { recursive: true });
    mkdirSync(join(root, ".knowledge", "inbox"), { recursive: true });
  }
  return root;
}

export function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, "utf8");
}

export function sh(root: string, cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

export function gitInit(root: string): void {
  sh(root, "git", ["init", "-q", "-b", "main"]);
}

export function commitAll(root: string, message = "commit"): void {
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "--allow-empty", "-m", message]);
}

// ULIDs used as fixed record ids. Their order is their creation order.
export const IDS = {
  a: "01JBQ7K3M2N8P4R6T9V0W1X2Y3",
  b: "01JBQ7K3M2N8P4R6T9V0W1X2Y4",
  c: "01JBQ7K3M2N8P4R6T9V0W1X2Y5",
  d: "01JBQ7K3M2N8P4R6T9V0W1X2Y6",
} as const;

export const BODY = "Quote every string scalar when writing front matter.\n\nThe parser reads bare digits as numbers.";

/** Valid front matter for a gotcha; override any field. */
export function front(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IDS.a,
    kind: "gotcha",
    summary: "an unquoted short SHA can parse as a number",
    provenance: { origin: "contemporaneous", date: "2026-10-31" },
    paths: ["src/knowledge/record.ts"],
    ...over,
  };
}

/** A canonical record or draft file in `area` with the given front matter. */
export function putRecord(root: string, area: "records" | "inbox", data: Record<string, unknown>, body = BODY): string {
  const rel = `.knowledge/${area}/${data.id}.md`;
  put(root, rel, serialiseRecord(data, body));
  return rel;
}
