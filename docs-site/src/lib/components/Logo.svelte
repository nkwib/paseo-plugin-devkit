<script>
  let { size = 28 } = $props();
</script>

<span class="logo">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" role="img" fill="none">
    <!-- a plug: two prongs, the body, and a cable that bends away -->
    <path class="prong" d="M12.5 3.5v5M19.5 3.5v5" stroke-width="2" stroke-linecap="round" />
    <rect x="8" y="8.5" width="16" height="11" rx="3.2" stroke="currentColor" stroke-width="1.8" />
    <path d="M12.5 14l2.4 2.4 4.6-4.8" class="prong" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M16 19.5v2.5a5 5 0 0 0 5 5h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>
  <span class="wordmark"><span class="prefix">paseo-plugin-</span>devkit</span>
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--c-text);
    font-weight: 600;
    letter-spacing: -0.02em;
    font-size: 1.05rem;
  }

  .prong {
    stroke: var(--c-accent);
  }

  .wordmark {
    font-family: var(--font-mono);
    font-size: 0.95rem;
  }

  .prefix {
    color: var(--c-text-muted);
    font-weight: 500;
  }

  @media (max-width: 520px) {
    .prefix {
      display: none;
    }
  }
</style>
