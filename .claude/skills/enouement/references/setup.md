# Setting enouement up in an existing repository

For a personal project or a small team's repo. Nothing here needs a network connection once enouement
itself is installed, and every step is a plain file in the repository you can review in the diff.

Work through the steps in order and tell the person what you are about to change before each step that
writes files. Ask before declaring modules — what counts as a module is their call.

## 0. Prerequisites

- Bun ≥ 1.3 and git (`bun --version`, `git --version`).
- `enou` on PATH. Check with `command -v enou`. If it is missing, install it from a clone of the
  enouement repository (it is not published to npm yet):

  ```bash
  git clone https://github.com/tyler-void/enouement ~/src/enouement   # or wherever the person keeps it
  cd ~/src/enouement && bun install && bun link
  enou --help        # bun link puts enou in ~/.bun/bin, which Bun's installer adds to PATH
  ```

## 1. Create the store

From the root of the target repository:

```bash
mkdir -p .knowledge/records .knowledge/inbox
touch .knowledge/records/.gitkeep .knowledge/inbox/.gitkeep
printf '.knowledge/** text eol=lf\n' >> .gitattributes
```

The `.gitattributes` line matters: records are byte-canonical, and a checkout that converts line
endings would make every record fail `enou lint`.

## 2. Declare modules

A path gets a current-truth view and integrity checks only if it belongs to a declared module. Look at
the repository layout, propose a short list — usually the top-level source directories or the main
subsystems, not every folder — and confirm with the person. Then:

```bash
enou modules add src/api
enou modules add src/db
enou modules list
enou modules uncovered     # tracked paths no module covers — fine if deliberate (docs, config)
```

Modules can be renamed later without losing knowledge (`enou modules move old new` keeps the old path
as `formerly`).

## 3. Claude Code: the hooks and the deny rules

Merge this into the repository's `.claude/settings.json` (committed, so it applies to anyone using
Claude Code here) — or `.claude/settings.local.json` for the person alone. Merge, don't overwrite:
keep any hooks and permissions already there.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "[ -d \"$CLAUDE_PROJECT_DIR/.knowledge\" ] || exit 0; command -v enou >/dev/null 2>&1 || exit 0; exec enou hook post-read",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -d \"$CLAUDE_PROJECT_DIR/.knowledge\" ] || exit 0; command -v enou >/dev/null 2>&1 || exit 0; exec enou hook session-start",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -d \"$CLAUDE_PROJECT_DIR/.knowledge\" ] || exit 0; command -v enou >/dev/null 2>&1 || exit 0; exec enou hook stop",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "permissions": {
    "deny": [
      "Bash(enou accept:*)",
      "Bash(enou reject:*)",
      "Bash(enou redact:*)"
    ]
  }
}
```

What each part does:

- **PostToolUse(Read)** — when the agent reads a file in a declared module, the module's current-truth
  view (plus records specific to that file) is added to its context, once per module per session.
- **SessionStart** — one line naming the modules that have knowledge and how many drafts are waiting;
  it also resets the once-per-session markers after compaction.
- **Stop** — if the session changed code in a declared module and captured nothing, the agent is asked
  once, before stopping, to capture drafts or say that nothing was learned.
- **permissions.deny** — the agent cannot run `enou accept`, `reject` or `redact`. Acceptance is the
  person's step; this is what keeps it so.

Every hook starts with a shell check, so in a clone without `.knowledge/`, or on a machine without
`enou`, it does nothing and prints nothing.

## 4. Git hooks (optional, recommended)

`enou lint` checks the store before commits and pushes. If the repository has no other git hooks:

```bash
mkdir -p .githooks && cp ~/src/enouement/.githooks/pre-commit ~/src/enouement/.githooks/pre-push .githooks/
git config core.hooksPath .githooks
```

If it already has hooks in `.git/hooks/`, add a line calling the enouement hook from the existing
`pre-commit` / `pre-push` instead of changing `core.hooksPath`.

## 5. The skill itself

So that Claude Code knows how to use enouement in every project, link this skill into the person's user
skills once:

```bash
ln -s ~/src/enouement/.claude/skills/enouement ~/.claude/skills/enouement
```

## 6. Other agents (optional)

Agents without Claude Code's hooks use the same commands through the shell, or through the MCP server:

```json
{
  "mcpServers": {
    "enouement": { "command": "eco-mcp" }
  }
}
```

Put that in the repository's `.mcp.json`. `bun link` installed the server as `eco-mcp` (the name changes
in a later release). It serves the repository it is started in — set `ENOU_ROOT` in the server's `env`
if your agent starts servers somewhere else. Its tools are `why`, `brief`, `view`, `log`, `show`,
`drafts` and `record`; there is deliberately no tool to accept, reject or redact.

For agents that read an `AGENTS.md`, a short section is enough: "This repository records why the code is
the way it is with enouement. Before changing code run `enou brief <paths>`; after a change, capture what
was learned with `enou record` (drafts only); never run `enou accept`, `reject` or `redact`."

## 7. Check it and commit it

```bash
enou lint            # expect: no findings
git add .knowledge .gitattributes .claude/settings.json && git commit -m "chore: set up enouement"
```

Stage the paths explicitly rather than `git add -A`.

## 8. Seed some knowledge (optional, but it is what makes it useful on day one)

Ask the person for the three to five things a new contributor most needs to know about this project —
the decision that surprises everyone, the invariant that must never break, the gotcha that has bitten
twice. Record each as a draft:

```bash
enou record --kind invariant --summary "..." --paths src/... \
  --provenance oral --source "told by the owner, $(date +%Y-%m-%d)" --body-file - <<'MD'
...
MD
```

Then show `enou drafts` and leave acceptance to them.

## Removing it

Delete `.knowledge/`, the `.gitattributes` line, the enouement entries in `.claude/settings.json`, and
the git hooks. Records remain in git history.
