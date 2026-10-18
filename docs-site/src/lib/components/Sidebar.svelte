<script>
  import { page } from '$app/state';
  import { activeHref } from '#lib/site.js';

  /** @type {{ sections: { label: string, items: { href: string, label: string }[] }[] }} */
  let { sections } = $props();

  const items = $derived(sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.label }))));
  const active = $derived(activeHref(items.map((item) => item.href), page.url.pathname));
  const current = $derived(items.find((item) => item.href === active));
  let open = $state(false);
</script>

{#snippet groups()}
  {#each sections as section (section.label)}
    <div class="group">
      <div class="group-label">{section.label}</div>
      <ul>
        {#each section.items as item (item.href)}
          <li>
            <a
              class="item"
              class:active={active === item.href}
              aria-current={active === item.href ? 'page' : undefined}
              href={item.href}
              onclick={() => (open = false)}
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
{/snippet}

<aside class="sidebar" aria-label="Section navigation">
  <details class="compact" bind:open>
    <summary>
      <span class="summary-label">Docs</span>
      {#if current}<span class="summary-current">{current.section} / {current.label}</span>{/if}
    </summary>
    <nav class="compact-nav">{@render groups()}</nav>
  </details>
  <nav class="wide-nav">{@render groups()}</nav>
</aside>

<style>
  .sidebar {
    position: sticky;
    top: var(--header-h);
    align-self: start;
    max-height: calc(100vh - var(--header-h));
    overflow-y: auto;
    padding: var(--sp-6) var(--sp-3) var(--sp-7);
  }

  .compact {
    display: none;
  }

  .group + .group {
    margin-top: var(--sp-5);
  }

  .group-label {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--c-text-subtle);
    padding: 0 var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    margin: 0;
  }

  .item {
    display: block;
    padding: 6px var(--sp-3);
    color: var(--c-text-muted);
    text-decoration: none;
    font-size: var(--fs-sm);
    border-radius: var(--r-md);
    transition: color 120ms ease, background 120ms ease;
    line-height: 1.4;
  }

  .item:hover {
    color: var(--c-text);
    background: var(--c-bg-alt);
    text-decoration: none;
  }

  .item.active {
    color: var(--c-accent);
    background: var(--c-bg-alt);
    font-weight: 500;
  }

  @media (max-width: 960px) {
    .sidebar {
      position: static;
      max-height: none;
      padding: var(--sp-4) 0 0;
    }

    .wide-nav {
      display: none;
    }

    .compact {
      display: block;
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      background: var(--c-surface);
    }

    summary {
      display: flex;
      align-items: baseline;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-4);
      cursor: pointer;
      font-size: var(--fs-sm);
      list-style: none;
    }

    summary::-webkit-details-marker {
      display: none;
    }

    summary::before {
      content: '';
      width: 0.45rem;
      height: 0.45rem;
      border-right: 1.5px solid var(--c-text-muted);
      border-bottom: 1.5px solid var(--c-text-muted);
      transform: rotate(-45deg);
      transition: transform 120ms ease;
      align-self: center;
    }

    details[open] summary::before {
      transform: rotate(45deg);
    }

    .summary-label {
      font-weight: 600;
      color: var(--c-text);
    }

    .summary-current {
      color: var(--c-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .compact-nav {
      padding: 0 var(--sp-2) var(--sp-4);
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--sp-4);
      border-top: 1px solid var(--c-border);
      padding-top: var(--sp-4);
    }

    .compact-nav .group + .group {
      margin-top: 0;
    }
  }
</style>
