// Where the agent is working. The server shells out to nothing since the scope narrowed to
// project memory, so binary discovery moved to bench/src/experiments/jev-rerank/bin.ts.

/** The workspace the agent is operating on. */
export function workspaceRoot(): string {
  return process.env.ECO_WORKSPACE || process.cwd();
}
