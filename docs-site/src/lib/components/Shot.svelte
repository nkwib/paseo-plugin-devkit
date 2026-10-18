<script>
  /**
   * A screenshot taken with `ppd web` on a dev daemon, with its intrinsic size so the page does not jump.
   * @type {{ src: string, alt: string, width: number, height: number, caption?: string, narrow?: boolean }}
   */
  let { src, alt, width, height, caption = '', narrow = false } = $props();
</script>

<figure class="shot" class:narrow>
  <img {src} {alt} {width} {height} loading="lazy" decoding="async" />
  {#if caption}<figcaption>{caption}</figcaption>{/if}
</figure>

<style>
  .shot {
    margin: var(--sp-5) 0;
  }

  .shot.narrow {
    max-width: 22rem;
  }

  img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    box-shadow: var(--sh-md);
    background: #fff;
  }

  figcaption {
    margin-top: var(--sp-2);
    font-size: var(--fs-sm);
    color: var(--c-text-muted);
  }
</style>
