# Contributing

Issues and PRs are welcome. Keep PRs to one focused change and explain the plugin pain it addresses.

## Setup

```sh
git clone https://github.com/nkwib/paseo-plugin-devkit.git
cd paseo-plugin-devkit
npm ci                 # also builds dist/
npm run typecheck
npm test
node dist/cli.js check examples/hello-plugin
```

Node 22.18+ runs the TypeScript sources directly, so `node src/cli.ts <command>` works without a build.

## Ground rules

- **Never touch the user's Paseo.** No code path may bind, probe or target port 6767 or write under `~/.paseo`. New commands that talk to a daemon go through `requireDaemon`, `runPaseo` and the guards in `src/safety.ts`. Add a test when you add a guard.
- **Devices are read-only.** `ppd android` must not send input, key events or settings changes.
- **Public actions stay opt-in.** Anything that pushes, tags, opens PRs or files issues prints the commands by default and needs a TTY confirmation or `--yes`.
- **Host-contract facts need a source.** When a check encodes a Paseo limit, cite the Paseo file or issue in a comment next to the constant (see `src/check/host.ts`).
- **Code adapted from Paseo keeps its notice.** Paseo is Apache-2.0. A file that copies or adapts Paseo code starts with a notice naming the source files, the commit and what changed, and is listed in `THIRD_PARTY_NOTICES` (`test/notices.test.ts` checks both).
- **App internals go through `src/compat.ts`.** A new dependency on the Paseo app's layout, daemon flags or web UI labels fails with a message that names what was expected, the verified Paseo version and the workaround (`layoutMismatch` and `VERIFIED_PASEO`) and gets a row in the README's Compatibility table.
- Tests that need Paseo, Hermes or a browser must skip cleanly when the tool is missing, so CI stays green on a bare runner.
- Prose: English, no em dashes, sentence-case headings.

## Docs site

`docs-site/` is a standalone SvelteKit project with its own lockfile.

```sh
cd docs-site
npm ci
npm run dev              # http://localhost:5173
npm run gen:commands     # after changing CLI help text: regenerates src/lib/commands.json from `ppd help`
npm run check:recipes    # ppd check on every plugin in docs-site/recipes
npm run build            # static site in docs-site/build
```

CI fails when `src/lib/commands.json` is out of date with the CLI or a recipe fails `ppd check`. Recipe pages show the recipe files as they are in the repo, so change the code there, not in the page.

## Releases

Maintainers only. Add a `## X.Y.Z (date)` section to `CHANGELOG.md`, bump `package.json`, commit, then tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks that the tag matches `package.json`, runs the tests and the package check, and publishes to npm with provenance through Trusted Publishing.
