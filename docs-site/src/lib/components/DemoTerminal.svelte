<script>
  /**
   * Static mock-terminal frame matching the family pattern:
   * three traffic-light dots, a filename label, and a monospace body.
   *
   * Pass the body as a raw HTML string. Use inline classes:
   *   <span class="kw|str|fn|cmt|prop|num|opt|err|good|prompt">…</span>
   * Curly braces inside the body must be HTML entities (&lbrace; / &rbrace;)
   * to avoid mdsvex/Svelte expression parsing.
   *
   * @type {{ filename?: string, body: string }}
   */
  let { filename = 'terminal', body } = $props();
</script>

<aside class="demo">
  <div class="demo-tab">
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="filename">{filename}</span>
  </div>
  <pre class="demo-code"><code>{@html body}</code></pre>
</aside>

<style>
  .demo {
    background: var(--c-code-bg);
    border: 1px solid var(--c-border);
    border-radius: var(--r-lg);
    box-shadow: var(--sh-md);
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    margin: var(--sp-5) 0;
  }

  .demo-tab {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--c-border);
    background: var(--c-bg-alt);
    color: var(--c-text-subtle);
    font-size: var(--fs-xs);
  }

  .dots { display: inline-flex; gap: 6px; }
  .dots i { width: 10px; height: 10px; border-radius: 999px; background: var(--c-border-strong); display: inline-block; }
  .dots i:nth-child(1) { background: var(--c-accent); opacity: 0.55; }
  .dots i:nth-child(2) { background: #f59e0b; opacity: 0.55; }
  .dots i:nth-child(3) { background: var(--c-good); opacity: 0.55; }

  .filename { font-family: var(--font-mono); }

  .demo-code {
    margin: 0;
    padding: var(--sp-5);
    background: transparent;
    color: var(--c-code-text);
    overflow-x: auto;
    font-size: var(--fs-sm);
    line-height: 1.7;
    font-family: var(--font-mono);
    white-space: pre;
  }

  .demo-code :global(code) {
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    font-family: var(--font-mono);
    font-size: inherit;
  }

  .demo-code :global(.kw)   { color: var(--c-code-keyword); }
  .demo-code :global(.str)  { color: var(--c-code-string); }
  .demo-code :global(.fn)   { color: var(--c-code-fn); }
  .demo-code :global(.cmt)  { color: var(--c-code-comment); font-style: italic; }
  .demo-code :global(.prop) { color: var(--c-code-prop); }
  .demo-code :global(.num)  { color: var(--c-code-num); }
  .demo-code :global(.opt)  { color: var(--c-code-prop); }
  .demo-code :global(.err)  { color: var(--c-code-deleted); }
  .demo-code :global(.good) { color: var(--c-code-inserted); }
  .demo-code :global(.prompt) {
    color: var(--c-text-subtle);
    margin-right: 0.4em;
    user-select: none;
  }
</style>
