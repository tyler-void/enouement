---
tags: [enouement]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

i just swapped the cache in src/cache.ts from an in-memory Map to sqlite because we kept losing everything whenever the box restarted. looked at redis too but thats overkill for one small server. make sure future me knows why.

Input files: src/cache.ts, .knowledge/modules.yaml, .gitattributes
