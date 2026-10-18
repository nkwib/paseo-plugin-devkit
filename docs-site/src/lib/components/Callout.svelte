<script>
  /** @type {{ kind?: 'info' | 'warn' | 'good' | 'tip', title?: string, children: any }} */
  let { kind = 'info', title = '', children } = $props();
</script>

<div class="callout {kind}">
  {#if title}
    <div class="title">{title}</div>
  {/if}
  <div class="body">{@render children()}</div>
</div>

<style>
  .callout {
    border: 1px solid var(--c-border);
    border-left: 3px solid var(--c-text-subtle);
    background: var(--c-bg-alt);
    border-radius: var(--r-md);
    padding: var(--sp-3) var(--sp-5);
    margin: var(--sp-5) 0;
    color: var(--c-text);
  }

  .info {
    border-left-color: var(--c-text-subtle);
  }

  .warn {
    border-left-color: var(--c-warn);
    background: var(--c-warn-soft);
  }

  .tip {
    border-left-color: var(--c-accent);
    background: var(--c-accent-soft);
  }

  .good {
    border-left-color: var(--c-good);
    background: var(--c-good-soft);
  }

  .title {
    font-weight: 600;
    margin-bottom: var(--sp-2);
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--c-text);
    font-family: var(--font-mono);
  }

  .body :global(p:last-child) {
    margin-bottom: 0;
  }
</style>
