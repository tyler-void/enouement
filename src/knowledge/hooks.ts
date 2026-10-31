// Claude Code hooks (contracts/hooks.md §3–§7): view delivery on Read, a SessionStart line, and the
// once-per-session capture offer on Stop.
//
// Every hook is fail-open: it exits 0 and prints nothing when it has nothing to say or cannot work,
// so knowledge never blocks a read (§7) and a contributor who never installed the tool never sees it
// (FR-042 — tier 1, the shell pre-filter, makes that free). Drafts are never injected (FR-045).
//
// Per-session state is a marker directory OUTSIDE the repository — every invocation is a fresh
// process, so in-memory state cannot dedup — claimed by exclusive create, because Claude Code issues
// parallel Reads and a check-then-write would let both inject (§3).

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { staticPrefix } from "./capture";
import { loadModules, resolveModule, type ModuleDecl, type ModulesConfig } from "./modules";
import { git, globMatch } from "./platform";
import { STORE_DIR, loadStore } from "./store";
import { buildTrust, statusOf, type TrustView } from "./trust";
// view.ts (and the why/symbols code behind it) loads only once a read has passed membership and
// dedup: a tier-2 miss must cost little more than starting the runtime (contracts/hooks.md §6).
const loadView = () => import("./view");

export type HookEvent = "post-read" | "session-start" | "stop";

// ---------------------------------------------------------------------------------------------
// Settings — the one source for docs, setup and tests

/**
 * Tier 1 (contracts/hooks.md §6): plain POSIX sh, so in a repository with no `.knowledge/`, or for
 * someone who never installed `enou`, the hook costs one `sh` and prints nothing. It must stay a
 * shell-form command (no `args`), or Claude Code runs it in exec form and the pre-filter is bypassed.
 * An unset $CLAUDE_PROJECT_DIR makes the test `[ -d "/.knowledge" ]`, which fails safe.
 */
export function prefilter(event: HookEvent): string {
  return `[ -d "$CLAUDE_PROJECT_DIR/.knowledge" ] || exit 0; command -v enou >/dev/null 2>&1 || exit 0; exec enou hook ${event}`;
}

/** Commands an agent must not run: they are a person's steps (FR-044a). */
export const DENY_RULES = ["Bash(enou accept:*)", "Bash(enou reject:*)", "Bash(enou redact:*)"] as const;

/** The `.claude/settings.json` fragment that installs enouement for Claude Code. */
export function claudeSettings() {
  const hook = (event: HookEvent) => [{ type: "command", command: prefilter(event), timeout: 10 }];
  return {
    hooks: {
      PostToolUse: [{ matcher: "Read", hooks: hook("post-read") }],
      SessionStart: [{ hooks: hook("session-start") }],
      Stop: [{ hooks: hook("stop") }],
    },
    permissions: { deny: [...DENY_RULES] },
  };
}

// ---------------------------------------------------------------------------------------------
// Payload and environment

export interface HookPayload {
  session_id?: unknown;
  cwd?: unknown;
  source?: unknown;
  stop_hook_active?: unknown;
  tool_input?: { file_path?: unknown };
}

export interface HookResult {
  /** Written to stdout verbatim; empty means "nothing to say". */
  stdout: string;
  /** A reason on stderr — only when something went wrong. */
  stderr?: string;
}

const SILENT: HookResult = { stdout: "" };

export function parsePayload(text: string): HookPayload | null {
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as HookPayload) : null;
  } catch {
    return null;
  }
}

/** The repository the hook acts on: $CLAUDE_PROJECT_DIR, else the payload's cwd. Null without a store. */
export function hookRoot(env: Record<string, string | undefined>, payload: HookPayload, fallback?: string): string | null {
  const base = env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === "string" ? payload.cwd : fallback);
  if (!base) return null;
  let dir = resolve(base);
  for (;;) {
    if (isDir(join(dir, STORE_DIR))) return safeRealpath(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** A path from the payload as a repository-relative `/` path, or null when it is outside. */
export function repoRelative(root: string, cwd: string, filePath: string): string | null {
  let abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  abs = safeRealpath(abs);
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

// ---------------------------------------------------------------------------------------------
// Marker directory

/**
 * `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/enou/<session>` — never inside the repository, so nothing
 * derived is ever committed. If the environment points inside the repository anyway, `/tmp` is used.
 */
export function markerRoot(env: Record<string, string | undefined>, repoRoot?: string): string {
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || "/tmp";
  let dir = resolve(base, "enou");
  if (repoRoot && insideOf(repoRoot, dir)) dir = resolve("/tmp", "enou");
  return dir;
}

function insideOf(root: string, p: string): boolean {
  const rel = relative(safeRealpath(root), p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * FNV-1a, 64-bit, as hex. Marker names need to be stable and spread out, not secret — and loading
 * node:crypto costs ~6 ms, more than the whole tier-2 budget of a hook that fires on every read.
 */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function sessionKey(id: unknown): string | null {
  if (typeof id !== "string" || id === "") return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : `h${fnv1a64(id)}`;
}

/** A readable, filesystem-safe marker name for a path; long paths fall back to a hash. */
function hashName(s: string): string {
  const enc = encodeURIComponent(s).replace(/\./g, "%2E");
  return enc.length <= 180 ? enc : `h${fnv1a64(s)}`;
}

export class Markers {
  constructor(readonly dir: string) {}
  /** Delivery markers live apart from session bookkeeping, so a compaction reset clears only them. */
  private path(kind: "m" | "f" | "r", key: string): string {
    return join(this.dir, "view", `${kind}-${kind === "r" ? key : hashName(key)}`);
  }
  has(kind: "m" | "f" | "r", key: string): boolean {
    return existsSync(this.path(kind, key));
  }
  /** Exclusive create: true for exactly one caller, however many race. */
  claim(kind: "m" | "f" | "r", key: string): boolean {
    const p = this.path(kind, key);
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "", { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
  clearDelivery(): void {
    rmSync(join(this.dir, "view"), { recursive: true, force: true });
  }
  claimOnce(name: string): boolean {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, name), "", { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
  read(name: string): string | null {
    try {
      return readFileSync(join(this.dir, name), "utf8");
    } catch {
      return null;
    }
  }
  write(name: string, text: string): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, name), text);
  }
}

export function markersFor(env: Record<string, string | undefined>, root: string, session: unknown): Markers | null {
  const key = sessionKey(session);
  return key ? new Markers(join(markerRoot(env, root), key)) : null;
}

// ---------------------------------------------------------------------------------------------
// PostToolUse(Read): the module's view, then records about this file specifically

const HEADER =
  "enouement — recorded knowledge for the file just read (accepted records only; drafts are never shown). " +
  "Cite record ids when you rely on them; `enou why <path>` gives the full reasons.";

/** How specifically a record path covers a file: exact > deeper directory > glob prefix. -1 = not at all. */
export function coverage(recordPath: string, file: string): number {
  const rp = recordPath.endsWith("/") ? recordPath.slice(0, -1) : recordPath;
  if (rp === file) return Number.MAX_SAFE_INTEGER;
  if (file.startsWith(`${rp}/`)) return rp.length;
  if (/[*?[\]{}]/.test(rp) && (globMatch(rp, file) || globMatch(`${rp}/**`, file))) return staticPrefix(rp).length;
  return -1;
}

export interface FileLines {
  shown: { id: string; kind: string; summary: string }[];
  overflow: string[];
}

/** Current records about `file` more specifically than `module`, not yet delivered this session. */
export function fileSpecific(trust: TrustView, file: string, module: ModuleDecl, markers: Markers | null, exclude: Set<string>): FileLines {
  const candidates: { id: string; kind: string; summary: string; score: number }[] = [];
  for (const [id, k] of trust.records) {
    if (exclude.has(id) || statusOf(trust, id).status !== "current") continue;
    const score = Math.max(...k.front.paths.map((p) => coverage(p, file)));
    if (score < 0 || (score !== Number.MAX_SAFE_INTEGER && score <= module.path.length)) continue;
    candidates.push({ id, kind: k.front.kind, summary: k.front.summary, score });
  }
  candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const shown: FileLines["shown"] = [];
  const overflow: string[] = [];
  for (const c of candidates) {
    // The already-delivered filter runs BEFORE the limit (contracts/hooks.md §3): a record past the
    // limit is never stranded behind ones that were delivered earlier.
    if (markers?.has("r", c.id)) continue;
    if (shown.length < module.view.max_file_records) {
      if (markers && !markers.claim("r", c.id)) continue; // a parallel read delivered it first
      shown.push({ id: c.id, kind: c.kind, summary: c.summary });
    } else overflow.push(c.id);
  }
  return { shown, overflow };
}

export async function postRead(root: string, payload: HookPayload, env: Record<string, string | undefined>): Promise<HookResult> {
  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string") return { stdout: "", stderr: "enou hook post-read: the payload has no tool_input.file_path" };
  const cwd = typeof payload.cwd === "string" ? payload.cwd : root;
  const file = repoRelative(root, cwd, filePath);
  if (!file || file.startsWith(`${STORE_DIR}/`)) return SILENT;

  // Tier 2, in its fixed order: module membership, then per-session dedup, and only then records.
  const modules = loadModules(root);
  if (!modules.ok) return { stdout: "", stderr: `enou hook post-read: .knowledge/modules.yaml is invalid (run enou lint)` };
  const res = resolveModule(modules.config, file);
  if (!res) return SILENT;
  const module = res.module;

  const markers = markersFor(env, root, payload.session_id);
  if (markers && markers.has("m", module.path) && markers.has("f", file)) return SILENT;
  const viewClaimed = markers ? markers.claim("m", module.path) : true;
  const fileClaimed = markers ? markers.claim("f", file) : true;
  if (!viewClaimed && !fileClaimed) return SILENT;

  const { moduleView, renderView } = await loadView();
  const trust = buildTrust(loadStore(root));
  const parts: string[] = [];
  const delivered = new Set<string>();
  if (viewClaimed) {
    const v = moduleView(trust, modules.config, module);
    const text = renderView(v);
    if (text) {
      parts.push(text);
      for (const e of v.shown) {
        delivered.add(e.id);
        markers?.claim("r", e.id);
      }
    }
  }
  if (fileClaimed) {
    const lines = fileSpecific(trust, file, module, markers, delivered);
    if (lines.shown.length || lines.overflow.length) {
      const out = [`Recorded about ${file} specifically:`];
      for (const l of lines.shown) out.push(`  ${l.id}  ${l.kind}  ${l.summary}`);
      if (lines.overflow.length)
        out.push(`… ${lines.overflow.length} more about this file, not shown: ${lines.overflow.join(", ")} — enou why ${file}`);
      parts.push(out.join("\n"));
    }
  }
  if (!parts.length) return SILENT;
  const additionalContext = [HEADER, ...parts].join("\n\n");
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }) };
}

// ---------------------------------------------------------------------------------------------
// SessionStart: reset on compaction, remember where the session started, name what is known

export interface SessionStartState {
  started_at: number;
  head: string | null;
  /** Paths already differing from HEAD when the session started, with a content hash ("" = deleted). */
  dirty: Record<string, string>;
  /** Record and draft ids present when the session started. */
  ids: string[];
}

/** Git's blob id for a file in the working tree, or "" when it does not exist. Loads node:crypto
 *  lazily: only the once-per-session SessionStart and Stop paths need it, never a Read. */
async function blobHasher(): Promise<(root: string, path: string) => string> {
  const { createHash } = await import("node:crypto");
  return (root, path) => {
    try {
      const content = readFileSync(join(root, path));
      return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
    } catch {
      return "";
    }
  };
}

function zList(stdout: string): string[] {
  return stdout.split("\0").filter(Boolean);
}

/** Paths differing from `base` (or HEAD), committed or not, plus untracked files. */
export function changedPaths(root: string, base: string | null): string[] {
  const out = new Set<string>();
  const ref = base ?? (git(["rev-parse", "--verify", "--quiet", "HEAD"], root).code === 0 ? "HEAD" : null);
  if (ref) for (const p of zList(git(["diff", "--name-only", "-z", ref], root).stdout)) out.add(p);
  else for (const p of zList(git(["ls-files", "-z", "--cached"], root).stdout)) out.add(p);
  for (const p of zList(git(["ls-files", "-z", "--others", "--exclude-standard"], root).stdout)) out.add(p);
  return [...out].sort();
}

export function storeIds(root: string): string[] {
  const ids: string[] = [];
  for (const area of ["records", "inbox"]) {
    try {
      for (const f of readdirSync(join(root, STORE_DIR, area))) if (f.endsWith(".md")) ids.push(f.slice(0, -3));
    } catch {
      /* an absent store directory holds no ids */
    }
  }
  return ids.sort();
}

function head(root: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function sessionStart(
  root: string,
  payload: HookPayload,
  env: Record<string, string | undefined>,
  now = Date.now(),
): Promise<HookResult> {
  const markers = markersFor(env, root, payload.session_id);
  if (markers) {
    // The injected views lived in the conversation; compaction or /clear removed them, so the
    // markers must go too, or the session would never see those modules again (§3).
    if (payload.source === "compact" || payload.source === "clear") markers.clearDelivery();
    if (markers.read("start.json") === null) {
      const blobHash = await blobHasher();
      const h = head(root);
      const dirty: Record<string, string> = {};
      for (const p of changedPaths(root, h)) dirty[p] = blobHash(root, p);
      const state: SessionStartState = { started_at: now, head: h, dirty, ids: storeIds(root) };
      markers.write("start.json", JSON.stringify(state));
    }
  }
  const line = await knowledgeLine(root);
  return line ? { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: line } }) } : SILENT;
}

/**
 * One line, so an agent whose reads bypass `Read` still learns that knowledge exists (§3,
 * Coexistence). A fixed projection of modules.yaml and record counts; empty when there is nothing
 * to name.
 */
export async function knowledgeLine(root: string): Promise<string> {
  const modules = loadModules(root);
  if (!modules.ok) return "";
  const { modulesOfRecord } = await loadView();
  const snapshot = loadStore(root);
  const trust = buildTrust(snapshot);
  const counts = new Map<string, number>();
  for (const [id, k] of trust.records) {
    if (statusOf(trust, id).status !== "current") continue;
    for (const m of modulesOfRecord(modules.config, k)) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const named = modules.config.modules.filter((m) => counts.get(m.path)).map((m) => `${m.path} (${counts.get(m.path)})`);
  const drafts = trust.drafts.size;
  if (!named.length && !drafts) return "";
  const parts = ["enouement: this repository records why its code is the way it is."];
  if (named.length)
    parts.push(
      `Modules with current knowledge: ${named.join(", ")}. Before changing code there, run \`enou brief <paths>\` or \`enou why <path>\`, and respect what is recorded.`,
    );
  if (drafts)
    parts.push(
      `${drafts} draft${drafts === 1 ? " is" : "s are"} waiting for a person to review and accept (\`enou drafts\`) — not knowledge yet; never accept them yourself.`,
    );
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------
// Stop: the capture offer, at most once per session (FR-004, US4)

export function captureReason(modules: string[]): string {
  return [
    `enouement: this session changed code in ${modules.join(", ")} and recorded no knowledge about it.`,
    "Before you finish: if you learned or decided something a future reader of this code will need — a decision",
    "and the alternatives you rejected, an invariant that must hold, a gotcha that will bite again, a convention —",
    "capture each as a draft: `enou record --kind <decision|invariant|gotcha|convention> --summary \"<one line>\"",
    "--paths <paths> --body \"<what is true and why>\"` (a decision also needs --rejected). Then tell the person",
    "which drafts you wrote so they can review and `enou accept` them — never accept them yourself.",
    "If nothing worth recording was learned, say so to the person in one line instead; they can put a",
    "`Knowledge-None: <reason>` trailer on the commit. Do not invent a record to satisfy this reminder.",
    "This reminder appears once per session.",
  ].join(" ");
}

function knowledgeNoneSince(root: string, state: SessionStartState | null): boolean {
  const args = ["log", "--format=%(trailers:key=Knowledge-None,valueonly)"];
  if (state?.head) args.push(`${state.head}..HEAD`);
  else if (state) args.push(`--since=@${Math.floor(state.started_at / 1000)}`);
  else return false;
  const r = git(args, root);
  return r.code === 0 && r.stdout.trim() !== "";
}

/** Changed paths this session touched in declared modules — excluding what was already dirty and untouched since. */
export async function sessionModules(root: string, config: ModulesConfig, state: SessionStartState | null): Promise<string[]> {
  const blobHash = await blobHasher();
  const out = new Set<string>();
  for (const p of changedPaths(root, state?.head ?? null)) {
    if (p.startsWith(`${STORE_DIR}/`)) continue;
    if (state && p in state.dirty && state.dirty[p] === blobHash(root, p)) continue;
    const m = resolveModule(config, p);
    if (m) out.add(m.module.path);
  }
  return [...out].sort();
}

function logOffer(root: string, entry: Record<string, unknown>): void {
  const r = git(["rev-parse", "--git-dir"], root);
  if (r.code !== 0) return;
  const gitDir = resolve(root, r.stdout.trim());
  try {
    mkdirSync(join(gitDir, "enou"), { recursive: true });
    appendFileSync(join(gitDir, "enou", "offers.jsonl"), JSON.stringify(entry) + "\n");
  } catch {
    /* the log is a convenience for measuring SC-007; never fail the hook over it */
  }
}

export async function stop(
  root: string,
  payload: HookPayload,
  env: Record<string, string | undefined>,
  now = Date.now(),
): Promise<HookResult> {
  if (payload.stop_hook_active === true) return SILENT; // we are already inside a continuation
  const markers = markersFor(env, root, payload.session_id);
  if (!markers || markers.read("offered") !== null) return SILENT;
  const modules = loadModules(root);
  if (!modules.ok) return SILENT;
  const raw = markers.read("start.json");
  let state: SessionStartState | null = null;
  try {
    state = raw ? (JSON.parse(raw) as SessionStartState) : null;
  } catch {
    state = null;
  }
  const touched = await sessionModules(root, modules.config, state);
  if (!touched.length) return SILENT;
  if (state) {
    const before = new Set(state.ids);
    if (storeIds(root).some((id) => !before.has(id))) return SILENT; // knowledge was captured
  }
  if (knowledgeNoneSince(root, state)) return SILENT; // a recorded decline (FR-030)
  if (!markers.claimOnce("offered")) return SILENT;
  logOffer(root, { at: new Date(now).toISOString(), session: sessionKey(payload.session_id), modules: touched, start_head: state?.head ?? null });
  return { stdout: JSON.stringify({ decision: "block", reason: captureReason(touched) }) };
}

// ---------------------------------------------------------------------------------------------

export async function runHookEvent(
  event: HookEvent,
  stdin: string,
  env: Record<string, string | undefined>,
  fallbackRoot?: string,
): Promise<HookResult> {
  const payload = parsePayload(stdin);
  if (!payload) return { stdout: "", stderr: `enou hook ${event}: stdin is not a JSON object` };
  const root = hookRoot(env, payload, fallbackRoot);
  if (!root) return SILENT; // no knowledge store: nothing to do, and nothing to say (FR-042)
  switch (event) {
    case "post-read":
      return postRead(root, payload, env);
    case "session-start":
      return sessionStart(root, payload, env);
    case "stop":
      return stop(root, payload, env);
  }
}
