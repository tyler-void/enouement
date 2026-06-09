// Suite registry. Select with BENCH_SUITE=sample-app | hono (default sample-app).

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Suite } from "../types";
import { TASKS as SAMPLE_TASKS } from "./suite";
import { HONO_TASKS } from "./oss-hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "..", "fixtures");

export function getSuite(name: string): Suite {
  switch (name) {
    case "hono": {
      const dir = join(FIXTURES, "oss", "hono");
      if (!existsSync(dir)) {
        throw new Error(
          `hono fixture missing. Clone it:\n  git clone --depth 1 https://github.com/honojs/hono ${dir}`,
        );
      }
      return { id: "hono", fixtureDir: dir, copyPerRun: false, tasks: HONO_TASKS };
    }
    case "sample-app":
    default:
      return {
        id: "sample-app",
        fixtureDir: join(FIXTURES, "sample-app"),
        copyPerRun: true,
        tasks: SAMPLE_TASKS,
      };
  }
}
