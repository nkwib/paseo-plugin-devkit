# paseo-plugin-devkit docs site

The docs site for [paseo-plugin-devkit](../): SvelteKit with adapter-static and mdsvex, fully prerendered, for
Cloudflare Pages. A standalone npm project with its own lockfile; it reads from the repository root but does not
import the devkit.

## Develop

```sh
cd docs-site
npm ci
npm run dev        # http://localhost:5173
```

`predev` and `prebuild` run `scripts/sync-content.mjs`, which snapshots into `src/lib/generated/` (gitignored):
the package version, the Node range and `VERIFIED_PASEO`, `CHANGELOG.md`, and the source files the recipe pages show
(`templates/agent-hook` and `recipes/`), highlighted at build time.

## Build

```sh
npm run build      # ./build, every route prerendered
npm run preview    # serve ./build
```

Prerendering checks links strictly: a link to a missing page or `#anchor` fails the build. mdsvex does not generate
heading ids, so headings that are link targets carry an explicit `id`.

## Generated and checked content

| Command | What it does | CI |
| --- | --- | --- |
| `npm run gen:commands` | Regenerates `src/lib/commands.json` from `ppd --help` and `ppd help <command>`. Run it after changing CLI help, and commit the result. | fails when the committed file differs |
| `npm run check:recipes` | Runs `ppd check` on every plugin in `recipes/`. Needs `npm ci` at the repository root. | runs on every push |
| `npm run build:og` | Rasterizes `static/og.svg` to `static/og.png` with system fonts. Commit the PNG. | |

Screenshots in `static/shots/` come from `ppd web` on a dev daemon; each page names the commands that made them.

## Deploy

Not deployed yet. With a Cloudflare Pages project (the name in `wrangler.toml` is a placeholder and decides the
`*.pages.dev` URL; `SITE` in `src/lib/site.js` and the `og:image` URLs in `src/app.html` must match it):

```sh
npm run build
npx wrangler pages deploy
```

Or connect the repository in the Cloudflare dashboard with root directory `docs-site`, build command
`npm ci && npm run build` and output directory `build`.
