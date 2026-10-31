# spec-kit extension: enouement

Hooks [enouement](https://github.com/tyler-void/enouement) into the spec-kit workflow:

| Hook | Command | What it does |
|---|---|---|
| `before_specify`, `before_plan` | `speckit.enouement.brief` | shows the recorded knowledge about the paths the feature will touch, and the gaps, before the spec or plan is written |
| `after_implement` | `speckit.enouement.capture` | captures what the finished feature taught as **drafts** (`enou record`); a person accepts them with `enou accept` |

The agent never accepts, rejects or redacts — those are the person's steps.

## Install into a repository

Requires `enou` on `PATH` (in a clone of enouement: `bun link`).

```sh
specify extension add <path-to-enouement>/.specify/extensions/enouement --dev
```

Then **move the `enouement` entry to the top of `after_implement`** in `.specify/extensions.yml`,
above the git extension's auto-commit. Installing appends hooks, and capture must run before the
commit so the drafts land in the same commit as the work they describe.

## Changing this extension (in the enouement repository itself)

`specify extension add` replaces the destination directory before copying into it, so it cannot
install from `.specify/extensions/enouement` onto itself. Copy the directory somewhere outside the
repository, edit the copy, then `specify extension remove enouement` and
`specify extension add <copy> --dev`, and restore the `after_implement` order.
`test/speckit.test.ts` checks the order and that the generated skills match these command files.
