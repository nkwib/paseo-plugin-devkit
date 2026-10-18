<script>
  import { page } from '$app/state';
  import Logo from './Logo.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { meta } from '#lib/generated/meta.js';
  import { NAV, REPO, activeHref } from '#lib/site.js';

  const active = $derived(activeHref(NAV.map((link) => link.href), page.url.pathname));
</script>

<header class="header">
  <div class="inner">
    <a href="/" class="brand" aria-label="paseo-plugin-devkit home">
      <Logo />
      <span class="version" aria-hidden="true">v{meta.version}</span>
    </a>

    <nav class="nav" aria-label="Primary">
      {#each NAV as link (link.href)}
        <a href={link.href} class="nav-link" class:active={active === link.href} aria-current={active === link.href ? 'page' : undefined}>
          {link.label}
        </a>
      {/each}
    </nav>

    <div class="actions">
      <a class="gh" href={REPO} target="_blank" rel="noopener" aria-label="GitHub repository">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-1.92c-3.2.69-3.87-1.55-3.87-1.55-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.73-1.52-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.94 10.94 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.41.35.78 1.05.78 2.12v3.14c0 .31.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
          />
        </svg>
      </a>
      <ThemeToggle />
    </div>
  </div>
</header>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: 50;
    height: var(--header-h);
    background: color-mix(in srgb, var(--c-bg) 88%, transparent);
    backdrop-filter: saturate(180%) blur(10px);
    -webkit-backdrop-filter: saturate(180%) blur(10px);
    border-bottom: 1px solid var(--c-border);
  }

  .inner {
    max-width: var(--wide-max);
    height: 100%;
    margin: 0 auto;
    padding: 0 var(--sp-5);
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--sp-5);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--c-text);
    text-decoration: none;
  }

  .version {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    color: var(--c-text-subtle);
    border: 1px solid var(--c-border);
    background: var(--c-bg-alt);
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }

  .nav {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }

  .nav-link {
    padding: var(--sp-2) var(--sp-3);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 500;
    border-radius: var(--r-md);
    text-decoration: none;
    transition: color 120ms ease, background 120ms ease;
  }

  .nav-link:hover {
    color: var(--c-text);
    background: var(--c-bg-alt);
    text-decoration: none;
  }

  .nav-link.active {
    color: var(--c-text);
    background: var(--c-bg-alt);
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .gh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    color: var(--c-text-muted);
    border-radius: var(--r-md);
    transition: color 120ms ease, background 120ms ease;
  }

  .gh:hover {
    color: var(--c-text);
    background: var(--c-bg-alt);
  }

  @media (max-width: 720px) {
    .inner {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--sp-3);
      padding-top: var(--sp-3);
      padding-bottom: var(--sp-3);
    }

    .nav {
      grid-column: 1 / -1;
      justify-self: stretch;
      justify-content: flex-start;
      overflow-x: auto;
      padding-bottom: 4px;
      scrollbar-width: none;
      order: 3;
    }

    .nav::-webkit-scrollbar {
      display: none;
    }

    .header {
      height: auto;
    }
  }
</style>
