<script>
  import { onMount } from 'svelte';

  let theme = $state(/** @type {'light' | 'dark'} */ ('light'));
  let mounted = $state(false);

  onMount(() => {
    const stored = localStorage.getItem('ppd-docs-theme');
    const initial =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    theme = initial;
    document.documentElement.dataset.theme = initial;
    mounted = true;
  });

  function toggle() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ppd-docs-theme', theme);
  }
</script>

<button
  type="button"
  class="theme-toggle"
  onclick={toggle}
  aria-label="Toggle color theme"
  title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
>
  {#if mounted && theme === 'dark'}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  {:else}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  {/if}
</button>

<style>
  .theme-toggle {
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--c-text-muted);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .theme-toggle:hover {
    color: var(--c-text);
    background: var(--c-bg-alt);
    border-color: var(--c-border-strong);
  }
</style>
