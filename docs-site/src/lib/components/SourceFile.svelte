<script>
  import { sources } from '#lib/generated/sources.js';
  import { blob } from '#lib/site.js';

  /**
   * A source file from the repo, snapshotted and highlighted by scripts/sync-content.mjs, so the page shows
   * exactly the code that is checked and tested.
   * @type {{ path: string }}
   */
  let { path } = $props();

  const source = $derived.by(() => {
    const found = sources[path];
    if (!found) throw new Error(`missing snapshot for ${path}: add it to scripts/sync-content.mjs`);
    return found;
  });
</script>

<figure class="source">
  <figcaption>
    <span class="label">{source.label}</span>
    <a href={blob(path)} target="_blank" rel="noopener">view on GitHub</a>
  </figcaption>
  {@html source.html}
</figure>

<style>
  .source {
    margin: var(--sp-5) 0;
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--c-code-bg);
  }

  figcaption {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--c-border);
    background: var(--c-bg-alt);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--c-text-muted);
  }

  figcaption a {
    color: var(--c-text-subtle);
    white-space: nowrap;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source :global(pre.code-block) {
    margin: 0;
    border: 0;
    border-radius: 0;
  }

  .source :global(pre.code-block::before) {
    content: none;
  }
</style>
