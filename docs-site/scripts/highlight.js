// Prism highlighting shared by mdsvex code fences (svelte.config.js) and the source snapshots
// (scripts/sync-content.mjs), so both render with the same grammar and classes.
import { createRequire } from 'node:module';
import { escapeSvelte } from 'mdsvex';

const require = createRequire(import.meta.url);
const Prism = require('prismjs');
const loadLanguages = require('prismjs/components/');

loadLanguages(['markup', 'css', 'clike', 'javascript', 'typescript', 'jsx', 'tsx', 'json', 'bash', 'diff', 'yaml']);

const ALIASES = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', console: 'bash', text: 'plain', mjs: 'javascript' };

/** Highlighted `<pre>` for a code block. `escapeForSvelte` when the HTML lands in a .svx file. */
export function highlight(code, lang, { escapeForSvelte = false } = {}) {
  const language = ALIASES[lang] || lang || 'plain';
  const grammar = Prism.languages[language];
  const html = grammar ? Prism.highlight(code, grammar, language) : Prism.util.encode(code).toString();
  const pre = `<pre class="code-block language-${language}" data-lang="${language === 'plain' ? '' : lang}"><code class="language-${language}">${escapeForSvelte ? escapeSvelte(html) : html}</code></pre>`;
  return pre;
}
