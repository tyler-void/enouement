---
type: llm
focus: trace
weight: 1
---

.claude/settings.json (or settings.local.json) registers enouement hooks that call `enou hook` behind a shell check, and denies the agent `enou accept`, `enou reject` and `enou redact`.
