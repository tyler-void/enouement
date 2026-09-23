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

## Pushing

**Never use `--no-verify`.** Not on `git push`, not on `git commit`.

A push blocked by the pre-push hook means **stop and report**. Do not work around it, do not
retry with the check disabled, and do not edit the term list to make the block go away.

The hook (`.git/hooks/pre-push`, with `.git/info/forbidden-terms`) is the last thing standing
between this public repository and material that must never reach it. On 2026-09-22 this
repository had to be deleted and its history rewritten because contest and company names had
already been published; the hook exists so that does not happen twice. A block is the guard
working, not an obstacle to route around.

**Never override `core.hooksPath` either** — not with `git -c core.hooksPath=…` for one command,
and not with `git config core.hooksPath`. Pointing it at an empty directory disables the guard
just as completely as `--no-verify`, and leaves no flag in the command to notice.

If a block looks like a false positive, say so and show the matching lines. Widening the rule is
a decision for the repository owner, not something to infer from a failed push.

## Owner privacy

The owner does not publish his legal name. Refer to him as **Tyler** or **@tyler-void**, nothing else.

This applies everywhere, not just to prose in the repository: file contents, commit messages,
branch names, issue and pull-request titles and bodies, code comments, and test fixtures. Email
addresses are fine — `code@tyler-void.dev` is already public in the git history.

`.git/info/forbidden-terms` carries the name forms, so the pre-push hook will block a push that
reintroduces one. Treat a block on that term the way you would any other: stop and report. Do not
remove the term to get the push through.
