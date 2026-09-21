#!/usr/bin/env bun
// Offline stand-in for the `semble` CLI (no model download), used by tests via ECO_SEMBLE_BIN.
// Emits semble's JSON in either shape it has shipped:
//   FAKE_SEMBLE_SHAPE=flat   (default) semble >= 0.4.0: results[] = {file_path, start_line, end_line, score, content}
//   FAKE_SEMBLE_SHAPE=nested           semble <= 0.3.x: results[] = {chunk: {file_path, ..., content, location}, score}
// Honours `-k N` like the real CLI (default 5).

const CHUNKS = [
  { file_path: "src/middleware/cors/index.ts", start_line: 1, end_line: 40, content: "export const cors = (options?: CORSOptions) => {\n  // sets Access-Control-Allow-Origin\n}" },
  { file_path: "src/middleware/jwt/jwt.ts", start_line: 1, end_line: 30, content: "export const jwt = (options) => { /* verify token */ }" },
  { file_path: "src/helper/cookie/index.ts", start_line: 1, end_line: 25, content: "export const getCookie = (c, key) => { /* parse cookie header */ }" },
  { file_path: "src/router/reg-exp-router/router.ts", start_line: 1, end_line: 60, content: "export class RegExpRouter { /* match routes */ }" },
  { file_path: "src/middleware/cors/index.test.ts", start_line: 1, end_line: 20, content: "import { cors } from '.'\ndescribe('CORS by Middleware', () => {})" },
  { file_path: "src/middleware/basic-auth/index.ts", start_line: 1, end_line: 35, content: "export const basicAuth = (options) => { /* check Authorization */ }" },
  { file_path: "src/index.ts", start_line: 1, end_line: 10, content: "export { Hono } from './hono'" },
];

const argv = process.argv.slice(2);
const kIdx = argv.findIndex((a) => a === "-k" || a === "--top-k");
const k = kIdx >= 0 ? Number(argv[kIdx + 1]) : 5;
const query = argv[1] ?? "";
const picked = CHUNKS.slice(0, k);
const shape = process.env.FAKE_SEMBLE_SHAPE ?? "flat";

const results =
  shape === "nested"
    ? picked.map((c, i) => ({ chunk: { ...c, location: `${c.file_path}:${c.start_line}-${c.end_line}` }, score: 1 - i / 10 }))
    : picked.map((c, i) => ({ ...c, score: 1 - i / 10 }));

console.log(JSON.stringify({ query, results }));
