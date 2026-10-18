<script>
  import { NPM, REPO, blob } from '#lib/site.js';
</script>

<footer class="footer">
  <div class="inner">
    <div class="meta">
      <span class="brand-mark">paseo-plugin-devkit</span>
      <span class="dot" aria-hidden="true">·</span>
      <span class="muted">Unofficial dev kit for Paseo plugin authors. Not affiliated with the Paseo team.</span>
    </div>
    <div class="links">
      <a href={REPO} target="_blank" rel="noopener">GitHub</a>
      <a href={NPM} target="_blank" rel="noopener">npm</a>
      <a href={blob('LICENSE')} target="_blank" rel="noopener">MIT</a>
      <a href={blob('THIRD_PARTY_NOTICES')} target="_blank" rel="noopener">Apache-2.0 notices</a>
      <a href="/docs/compatibility">Compatibility</a>
      <a href="/docs/changelog">Changelog</a>
    </div>
    <div class="copyright">Built with SvelteKit and MDsveX.</div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--c-border);
    background: var(--c-bg-alt);
    margin-top: var(--sp-9);
    padding: var(--sp-6) var(--sp-5);
  }

  .inner {
    max-width: var(--wide-max);
    margin: 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-4) var(--sp-6);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }

  .meta {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .brand-mark {
    font-family: var(--font-mono);
    color: var(--c-text);
    font-weight: 600;
    white-space: nowrap;
  }

  .dot {
    color: var(--c-text-subtle);
  }

  .muted {
    color: var(--c-text-muted);
  }

  .links {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-5);
    margin-left: auto;
    flex-wrap: wrap;
  }

  .links a {
    color: var(--c-text-muted);
    text-decoration: none;
    font-size: var(--fs-sm);
  }

  .links a:hover {
    color: var(--c-text);
    text-decoration: underline;
  }

  .copyright {
    color: var(--c-text-subtle);
    font-size: var(--fs-xs);
    flex-basis: 100%;
  }

  @media (max-width: 720px) {
    .meta {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--sp-1);
    }

    .dot {
      display: none;
    }
  }
</style>
