<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
specs/001-continuous-project-knowledge/plan.md

Project principles are ratified in .specify/memory/constitution.md (v1.1.0) and
govern this work — in particular: label every number measured/derived/cited, never
ship a confidently wrong answer, and supersede rather than erase.
<!-- SPECKIT END -->

## Commit messages

Write every commit message with a **quoted heredoc**, never `-m`:

```sh
git commit -F - <<'MSG'
subject line

body
MSG
```

The quoted delimiter (`<<'MSG'`, not `<<MSG`) is what stops the shell expanding the body.

This repository's commit messages routinely quote shell commands and file paths in backticks, so
`git commit -m "... \`enou init\` ..."` runs them. Commit `ad0a567` did exactly that: the shell
executed two backticked commands and their output — nothing — replaced the text, leaving "NOT
build , which is spec 002.  exists". It was already pushed to a branch that must not be
force-pushed, so it could only be corrected forward by a follow-up commit.
