// Module declarations and resolution (FR-024, FR-037, data-model §2.4) — tasks.md T010.

import { describe, expect, test } from "bun:test";
import { loadModules, parseModules, PUBLISHED_DEFAULTS, resolveModule, type ModulesConfig } from "../src/knowledge/modules";
import { tempRoot } from "./support/repo";

function config(text: string): ModulesConfig {
  const r = parseModules(text);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.config;
}

describe("parseModules", () => {
  test("no file means nothing declared, with the published defaults", () => {
    const r = loadModules(tempRoot());
    expect(r.ok && r.config).toEqual({ defaults: { ...PUBLISHED_DEFAULTS }, modules: [] });
  });

  test("defaults override the published ones; a module overrides the defaults for itself only", () => {
    const c = config(`
defaults:
  view: { max_records: 10 }
modules:
  - path: src/a
    view: { max_summary: 80 }
  - path: src/b/
`);
    expect(c.defaults).toEqual({ ...PUBLISHED_DEFAULTS, max_records: 10 });
    expect(c.modules[0]!.view).toEqual({ ...PUBLISHED_DEFAULTS, max_records: 10, max_summary: 80 });
    expect(c.modules[1]!.view).toEqual(c.defaults);
    expect(c.modules[1]!.path).toBe("src/b");
  });

  test("a typo is an error, not a silently ignored key", () => {
    const r = parseModules(`modules:\n  - path: src/a\n    view: { max_record: 5 }\n  - path: /abs\n  - path: src/a\n  - formerly: []\n`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues.map((i) => i.field)).toEqual([
      "modules[0].view.max_record",
      "modules[1].path",
      "modules[2].path",
      "modules[3].path",
    ]);
  });
});

describe("resolveModule — total and independent of file order on disk", () => {
  const c = config(`
modules:
  - path: src
  - path: src/knowledge
    formerly: [src/decide, src/old/**/legacy]
  - path: bench/src
    formerly: [src/backends]
`);

  test("a path belongs to the module that declares it, or to nothing", () => {
    expect(resolveModule(c, "src/knowledge/id.ts")?.module.path).toBe("src/knowledge");
    expect(resolveModule(c, "src/knowledge")?.module.path).toBe("src/knowledge");
    expect(resolveModule(c, "src/knowledgebase/x.ts")?.module.path).toBe("src");
    expect(resolveModule(c, "docs/readme.md")).toBeNull();
  });

  test("a current path beats another module's formerly, even a less specific one", () => {
    // src/backends is bench/src's former path, but `src` currently covers it.
    expect(resolveModule(c, "src/backends/semantic.ts")).toMatchObject({ module: { path: "src" }, via: "path" });
  });

  test("formerly resolves a renamed path when no current path claims it", () => {
    const only = config(`modules:\n  - path: bench/src\n    formerly: [src/backends]\n`);
    expect(resolveModule(only, "src/backends/semantic.ts")).toMatchObject({ module: { path: "bench/src" }, via: "formerly" });
  });

  test("globs in formerly match beneath them", () => {
    const only = config(`modules:\n  - path: src/knowledge\n    formerly: [src/old/**/legacy]\n`);
    expect(resolveModule(only, "src/old/x/y/legacy/z.ts")?.module.path).toBe("src/knowledge");
  });

  test("the more specific declaration wins, then declaration order", () => {
    const tie = config(`modules:\n  - path: a\n    formerly: [old]\n  - path: b\n    formerly: [old]\n`);
    expect(resolveModule(tie, "old/file.ts")?.module.path).toBe("a");
    const reversed = config(`modules:\n  - path: src/knowledge\n  - path: src\n`);
    expect(resolveModule(reversed, "src/knowledge/id.ts")?.module.path).toBe("src/knowledge");
  });
});
