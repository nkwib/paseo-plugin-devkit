<script>
  import Sidebar from '#lib/components/Sidebar.svelte';
  import { SECTIONS } from '#lib/site.js';

  let { children } = $props();
</script>

<div class="docs-shell">
  <Sidebar sections={SECTIONS} />
  <article class="docs-article">
    {@render children()}
  </article>
</div>

<style>
  .docs-shell {
    max-width: var(--wide-max);
    margin: 0 auto;
    padding: 0 var(--sp-5);
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    gap: var(--sp-7);
    align-items: start;
  }

  .docs-article {
    padding: var(--sp-7) 0 var(--sp-9);
    max-width: var(--content-max);
    width: 100%;
    min-width: 0;
  }

  .docs-article :global(h1) {
    font-size: var(--fs-2xl);
    margin-top: 0;
  }

  .docs-article :global(h2),
  .docs-article :global(h3) {
    scroll-margin-top: calc(var(--header-h) + var(--sp-4));
  }

  .docs-article :global(table) {
    display: block;
    overflow-x: auto;
  }

  .docs-article :global(.lede) {
    font-size: var(--fs-md);
    color: var(--c-text-muted);
  }

  @media (max-width: 960px) {
    .docs-shell {
      grid-template-columns: 1fr;
      gap: 0;
    }

    .docs-article {
      padding: var(--sp-5) 0 var(--sp-7);
    }
  }
</style>
