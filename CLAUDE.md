<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
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
`git commit -m` runs them. One commit on a feature branch did exactly that: the shell executed
two backticked commands and their empty output replaced the text, leaving a sentence with holes
in it. It was already pushed to a branch that must not be force-pushed, so it could only be
corrected forward by a follow-up commit.

## Staging

Stage **explicit paths**, never `git add -A`.

`git add -A` picks up whatever happens to be untracked — a tool cache, a generated file, a
scratch note — and a branch that lacks the relevant `.gitignore` rule will commit it silently.
That has already happened here once: a 236 KB catalog cache landed in a commit because the
ignore rule existed on a different branch.

This matters more than tidiness in this repository, which is public and has a local pre-push
guard (`.git/hooks/pre-push`) precisely because private material must never reach it. Naming
paths is how you stay certain of what you are publishing.
