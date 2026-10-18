<script>
  import { page } from '$app/state';
  import { SITE } from '#lib/site.js';

  /** @type {{ title?: string, description: string }} */
  let { title, description } = $props();

  const full = $derived(title ? `${title} · paseo-plugin-devkit` : 'paseo-plugin-devkit: test, verify and ship Paseo plugins');
  const url = $derived(SITE + (page.url.pathname === '/' ? '/' : page.url.pathname));
</script>

<svelte:head>
  <title>{full}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={url} />
  <meta property="og:title" content={full} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta name="twitter:title" content={full} />
  <meta name="twitter:description" content={description} />
</svelte:head>
