// The spec-kit extension (contracts/hooks.md §2) — tasks.md T025, T026, T032; plan.md binding
// test #10.
//
// T032 is the load-bearing one: `after_implement` capture must run BEFORE the git extension's
// auto-commit. Inverted, the drafts are committed one commit late and the derived implementing
// commit (data-model §2.7) points at the wrong commit — a silent corruption. `specify extension add`
// APPENDS hooks, so a reinstall inverts the order unless someone moves it back; this test is what
// notices.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "../src/knowledge/platform";

const ROOT = join(import.meta.dir, "..");
const EXT = join(ROOT, ".specify", "extensions", "enouement");

interface Hook {
  extension: string;
  command: string;
  enabled?: boolean;
  optional?: boolean;
}

const config = parseYaml(readFileSync(join(ROOT, ".specify", "extensions.yml"), "utf8")) as {
  hooks: Record<string, Hook[]>;
};
const manifest = parseYaml(readFileSync(join(EXT, "extension.yml"), "utf8")) as {
  extension: { id: string };
  provides: { commands: { name: string; file: string }[] };
  hooks: Record<string, { command: string; optional?: boolean }>;
};

/** A markdown command or skill file without its front matter. */
function body(path: string): string {
  const text = readFileSync(path, "utf8");
  return text.startsWith("---\n") ? text.slice(text.indexOf("\n---\n", 4) + 5).trim() : text.trim();
}

describe("spec-kit extension: enouement", () => {
  test("after_implement capture runs BEFORE the git auto-commit (T026, T032)", () => {
    const hooks = (config.hooks.after_implement ?? []).filter((h) => h.enabled !== false);
    const capture = hooks.findIndex((h) => h.extension === "enouement" && h.command === "speckit.enouement.capture");
    const commit = hooks.findIndex((h) => h.extension === "git" && h.command === "speckit.git.commit");
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThanOrEqual(0);
    expect(capture).toBeLessThan(commit);
  });

  test("capture and brief are mandatory hooks — triggered by the workflow, never left to memory", () => {
    for (const [event, command] of [
      ["after_implement", "speckit.enouement.capture"],
      ["before_specify", "speckit.enouement.brief"],
      ["before_plan", "speckit.enouement.brief"],
    ] as const) {
      const h = (config.hooks[event] ?? []).find((x) => x.extension === "enouement");
      expect(h?.command).toBe(command);
      expect(h?.optional).toBe(false);
      expect(h?.enabled).not.toBe(false);
    }
  });

  test("the manifest's command files exist, and the generated skills say exactly what they say", () => {
    expect(manifest.extension.id).toBe("enouement");
    for (const c of manifest.provides.commands) {
      const file = join(EXT, c.file);
      expect(existsSync(file)).toBe(true);
      const skill = join(ROOT, ".claude", "skills", c.name.replace(/\./g, "-"), "SKILL.md");
      expect(existsSync(skill)).toBe(true);
      expect(body(skill)).toBe(body(file));
    }
  });

  test("capture writes drafts and hands acceptance to the person; it never accepts, rejects or redacts", () => {
    const capture = body(join(EXT, "commands", "speckit.enouement.capture.md"));
    expect(capture).toContain("enou record");
    expect(capture).toContain("enou drafts");
    expect(capture).toContain("You never run `enou accept`, `enou reject` or `enou redact`");
    expect(capture).toContain("Knowledge-None:");
    // Every line that mentions accepting tells the PERSON to do it, or forbids the agent from doing it.
    for (const line of capture.split("\n").filter((l) => l.includes("enou accept")))
      expect(/never|you accept|run `enou accept <id>|then run `enou accept|then run: enou accept/i.test(line) || line.includes("> ")).toBe(true);
  });

  test("brief only reads, and never presents an inference as recorded knowledge", () => {
    const brief = body(join(EXT, "commands", "speckit.enouement.brief.md"));
    expect(brief).toContain("enou brief");
    expect(brief).toContain("enou why");
    expect(brief).toContain("never runs `enou record`, `enou accept`, `enou reject` or");
    expect(brief).toContain("Never infer a reason from the code");
  });
});
