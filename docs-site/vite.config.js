import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { defineConfig } from 'vite';
import { highlight } from './scripts/highlight.js';

// SvelteKit 3 takes its configuration here; there is no svelte.config.js.
export default defineConfig({
  plugins: [
    sveltekit({
      extensions: ['.svelte', '.svx'],
      preprocess: [
        vitePreprocess(),
        mdsvex({
          extensions: ['.svx'],
          smartypants: false,
          highlight: { highlighter: (code, lang) => highlight(code, lang, { escapeForSvelte: true }) }
        })
      ],
      // A link to a missing page or #anchor fails the build.
      prerender: { handleHttpError: 'fail', handleMissingId: 'fail' },
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        // Cloudflare Pages serves 404.html for unknown paths; the app renders +error.svelte in it.
        fallback: '404.html',
        precompress: false,
        strict: true
      })
    })
  ]
});
