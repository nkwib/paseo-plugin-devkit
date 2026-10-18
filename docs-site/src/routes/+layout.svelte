<script>
  import '@fontsource/inter/400.css';
  import '@fontsource/inter/500.css';
  import '@fontsource/inter/600.css';
  import '@fontsource/inter/700.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/500.css';
  import '../styles/global.css';
  import Header from '#lib/components/Header.svelte';
  import Footer from '#lib/components/Footer.svelte';

  let { children } = $props();
</script>

<svelte:head>
  <script>
    // Apply the stored theme before paint so the page does not flash.
    (function () {
      try {
        var stored = localStorage.getItem('ppd-docs-theme');
        var theme =
          stored === 'light' || stored === 'dark'
            ? stored
            : window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light';
        document.documentElement.dataset.theme = theme;
      } catch (_) {}
    })();
  </script>
</svelte:head>

<a class="skip" href="#main">Skip to content</a>
<div class="page-shell">
  <Header />
  <main id="main" class="page-content">
    {@render children()}
  </main>
  <Footer />
</div>

<style>
  .page-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .page-content {
    flex: 1;
  }

  .skip {
    position: absolute;
    left: var(--sp-3);
    top: -3rem;
    z-index: 100;
    padding: var(--sp-2) var(--sp-3);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
  }

  .skip:focus {
    top: var(--sp-3);
  }
</style>
