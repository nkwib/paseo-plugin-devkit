# Releases and the Paseo plugin registry

Registry: `getpaseo/plugins` (README.md, REVIEW.md, BOTS.md). Read them before any submission; rules change.

## Before anything public

`ppd registry precheck <plugin>`: OVERVIEW.md lint, manifest media and icon, lockfile sync, `build` sanity, listing files committed. Done when it reports no errors.

OVERVIEW.md rules: plain factual prose in sentence case; what it does, how it works if not obvious, setup, capabilities, data flow and limits. Leave out install commands (`paseo plugin add`, `npm install`, `npm i`), em dashes, badges, changelog, contributing and license sections, raw HTML, relative links. Keep claims in step with the code (numbers, limits, platforms).

## Release (user-run)

`ppd release <patch|minor|major|X.Y.Z> --dry-run` shows the exact commands: version bump, changelog section, `chore: release X` commit, annotated tag, push, `gh release create`. Hand the command without `--dry-run` to the user; it refuses to run without a TTY unless `--yes`.

## First listing

Submit through the web form only: `ppd registry submit` prints a prefilled form URL for the user to open. The form applies the `submission` label that intake requires; an issue filed with `gh issue create` from a non-collaborator gets no label and is ignored.

Afterwards verify: the issue has the `submission` label, and the bot opened a review PR (intake retries every 30 minutes). Report the PR, not the issue, as the outcome.

## Updates

- npm releases receive automatic bump PRs.
- Git releases never do. After the tag is pushed: `ppd registry update <plugin> --registry <fork checkout> --tag vX.Y.Z`. It branches from `upstream/main`, edits only `artifact.commit` and `artifact.tag`, runs `node scripts/validate.ts --online --changed` and prints the push and `gh pr create` commands. `--yes` runs them.
- On macOS the validator falsely reports "The plugin directory points outside the repository" when `TMPDIR` is under `/var` (realpath on one side only). `ppd` sets a canonical `TMPDIR`; by hand use `TMPDIR=$(mktemp -d /private/tmp/reg.XXXX)`.
