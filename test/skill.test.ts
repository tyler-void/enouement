// The enouement skill's setup guide carries the Claude Code settings as a JSON block. It must be
// exactly what the code produces, or a person following the guide installs hooks that differ from
// the ones the tests verify.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeSettings } from "../src/knowledge/hooks";

const SKILL = join(import.meta.dir, "..", ".claude", "skills", "enouement");

test("setup.md's settings block equals claudeSettings()", () => {
  const md = readFileSync(join(SKILL, "references", "setup.md"), "utf8");
  const block = /```json\n(\{\n  "hooks"[\s\S]*?\n\})\n```/.exec(md);
  expect(block).not.toBeNull();
  expect(JSON.parse(block![1]!)).toEqual(claudeSettings());
});

test("the skill never tells the agent to accept, reject or redact", () => {
  const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  for (const line of skill.split("\n").filter((l) => /^\s*enou (accept|reject|redact)\b/.test(l))) throw new Error(`runs a person's step: ${line}`);
  expect(skill).toContain("never run them yourself");
});
