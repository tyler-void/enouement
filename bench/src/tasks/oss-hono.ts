// Navigation/location tasks against the real OSS repo (honojs/hono).
// Post-audit hardening: grade on the EXACT canonical file path (not a loose directory fragment
// that also matches the co-located *.test.ts or a sibling file), confirm the named file actually
// defines the symbol, and reject test-file answers. The grader also asserts the expected file
// exists in the fixture so it can't silently pass on a stale path.
//
// Reproduce: git clone --depth 1 https://github.com/honojs/hono bench/fixtures/oss/hono
// Authored at HEAD e50df01.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../types";

const HONO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "oss", "hono");

function navTask(id: string, symbol: string, what: string, expectPath: string): Task {
  return {
    id,
    type: "navigate",
    prompt: `In this repository, which source file defines ${what} (\`${symbol}\`)? Answer with the exact relative file path (e.g. src/foo/bar.ts).`,
    setup: () => {}, // read-only
    check: (_workdir, finalAnswer) => {
      const ans = finalAnswer.replace(/\\/g, "/").toLowerCase();
      const want = expectPath.toLowerCase();
      // Grader integrity: the expected file must really exist and define the symbol.
      const exists = existsSync(join(HONO, expectPath));
      const defines = exists && new RegExp(`\\b${symbol}\\b`).test(readFileSync(join(HONO, expectPath), "utf8"));
      const named = ans.includes(want); // exact full path required
      const notTest = !/\.(test|spec)\./.test(ans.match(/[\w./-]+\.tsx?/)?.[0] ?? "");
      const pass = named && notTest && defines;
      return {
        pass,
        detail: pass
          ? `named exact path ${expectPath}`
          : `want "${expectPath}" (exists=${exists}, defines=${defines}); got "${finalAnswer.slice(0, 100)}"`,
      };
    },
  };
}

export const HONO_TASKS: Task[] = [
  navTask("find-cors", "cors", "the CORS middleware", "src/middleware/cors/index.ts"),
  navTask("find-basic-auth", "basicAuth", "the Basic Authentication middleware", "src/middleware/basic-auth/index.ts"),
  navTask("find-get-cookie", "getCookie", "the helper that reads a cookie from the request", "src/helper/cookie/index.ts"),
  navTask("find-jwt", "jwt", "the JWT middleware", "src/middleware/jwt/jwt.ts"),
  navTask("find-regexp-router", "RegExpRouter", "the RegExp-based router implementation", "src/router/reg-exp-router/router.ts"),
];
