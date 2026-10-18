<script>
  import { page } from '$app/state';
  import PageMeta from '#lib/components/PageMeta.svelte';
</script>

<PageMeta title={page.status === 404 ? 'Not found' : 'Error'} description="This page does not exist." />

<section class="error">
  <p class="code">{page.status}</p>
  <h1>{page.status === 404 ? 'No such page' : 'Something went wrong'}</h1>
  <p class="text">
    {page.status === 404 ? 'The page you asked for is not part of these docs.' : page.error?.message}
  </p>
  <p class="links">
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
    <a href="/docs/commands">Commands</a>
  </p>
</section>

<style>
  .error {
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--sp-9) var(--sp-5);
    text-align: center;
  }

  .code {
    font-family: var(--font-mono);
    color: var(--c-accent);
    margin: 0 0 var(--sp-2);
  }

  h1 {
    margin: 0 0 var(--sp-3);
  }

  .text {
    color: var(--c-text-muted);
  }

  .links {
    display: flex;
    justify-content: center;
    gap: var(--sp-5);
  }
</style>
