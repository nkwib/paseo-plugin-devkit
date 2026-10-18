<script>
  import DemoTerminal from '#lib/components/DemoTerminal.svelte';
  import PageMeta from '#lib/components/PageMeta.svelte';
  import { meta } from '#lib/generated/meta.js';

  // Real output from a plugin made with `ppd create` (home directory shortened to ~).
  const demo = `<span class="prompt">$</span> npx ppd daemon up --workspace .
dev daemon "default" up
  url:   http://127.0.0.1:7800
  home:  $TMPDIR/ppd-default-2kCaQs
  pid:   84941
  paseo: 0.11.4
workspace created for ~/code/my-plugin
<span class="prompt">$</span> npx ppd check | tail -1
<span class="good">13 passed, 0 warnings, 0 failed, 0 skipped</span>
<span class="prompt">$</span> npx ppd install | head -3
installing . as my-plugin into http://127.0.0.1:7800
my-plugin: <span class="good">running</span> (installed)
client: passes the app's registration rules
<span class="prompt">$</span> npx ppd web --command <span class="str">"Open Hello panel"</span> --click Greet --shot out/hello.png
opened workspace my-plugin (wks_61e6e477b7e141dd)
screenshot: ~/code/my-plugin/out/hello.png
console errors: none
plugin evaluation errors: none`;

  const features = [
    {
      title: 'An isolated dev daemon',
      command: 'ppd daemon up',
      text: 'A detached Paseo daemon in a fresh home under $TMPDIR, on a free port from 7800-7899, with plugins and the web UI on and relay, MCP and speech off. Port 6767 and ~/.paseo are refused, and only homes ppd marked are ever deleted.',
      href: '/docs/safety',
      icon: 'M4 6h16v12H4zM8 10h8M8 14h5'
    },
    {
      title: 'Host-contract checks',
      command: 'ppd check',
      text: "Compiles and evaluates with the installed Paseo app's own compiler, then applies the app's client registration rules, its Lucide icon names, Hermes class syntax, parse and VM runs, bundle budgets and import boundaries. The same checks run as a vitest suite.",
      href: '/docs/check',
      icon: 'M5 12l4 4 10-10'
    },
    {
      title: 'A scripted fake agent',
      command: 'ppd daemon up --fake-agent',
      text: 'A credential-free provider that runs one scripted turn per prompt: say, think, write, edit, bash, mcp, sleep, fail. Real timeline items, real file effects, and real calls to the MCP servers your plugin injects.',
      href: '/docs/fake-agent',
      icon: 'M9 7l-5 5 5 5M15 7l5 5-5 5'
    },
    {
      title: 'A fast dev loop',
      command: 'ppd create · ppd dev',
      text: "Templates that pass ppd check and install as is. ppd dev reloads on every change, re-checks the client and streams plugin logs; ppd install exits 1 when the app would silently drop your UI.",
      href: '/docs/getting-started',
      icon: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4'
    },
    {
      title: 'Web UI and phone',
      command: 'ppd web · ppd android',
      text: 'Open the workspace in Chrome, run Command Center items, click by accessible name and screenshot at any viewport; a plugin client the app fails to evaluate fails the run. Connect a phone over adb reverse with read-only device checks.',
      href: '/docs/android',
      icon: 'M7 3h10v18H7zM11 18h2'
    },
    {
      title: 'Registry and release',
      command: 'ppd registry · ppd release',
      text: 'Lint a listing before you submit it, get the prefilled submission form, and prepare registry updates. Releases check the remote before they commit and tag. Public actions print commands or ask first.',
      href: '/docs/commands#registry',
      icon: 'M12 3l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 17l8 4 8-4'
    }
  ];
</script>

<PageMeta
  description="An unofficial dev kit for Paseo plugin authors: an isolated dev daemon, host-contract checks with the Paseo app's own compiler, a scripted fake agent, web UI screenshots, phone testing, registry and release helpers."
/>

<section class="hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <span class="badge">
        <span class="dot" aria-hidden="true"></span>
        v{meta.version} · verified on Paseo {meta.verifiedPaseo} · unofficial
      </span>
      <h1>
        Test Paseo plugins.<br />
        Never touch <span class="accent">your real Paseo</span>.
      </h1>
      <p class="lede">
        <strong>ppd</strong> is a CLI, vitest helpers and a Claude Code skill for Paseo plugin authors. One command
        starts a throwaway dev daemon; another checks your plugin against the host's undocumented runtime contract
        before you install it.
      </p>

      <div class="cta">
        <a class="btn primary" href="/docs/getting-started">Get started</a>
        <a class="btn ghost" href="/docs/commands">Commands</a>
      </div>

      <pre class="install"><span class="prompt">$</span> npm install -D paseo-plugin-devkit</pre>
    </div>

    <div class="hero-demo">
      <DemoTerminal filename="~/code/my-plugin" body={demo} />
    </div>
  </div>
</section>

<section class="features" aria-label="What ppd does">
  <div class="features-inner">
    {#each features as feature (feature.title)}
      <a class="feature" href={feature.href}>
        <div class="feature-head">
          <span class="feature-icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d={feature.icon} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <h2>{feature.title}</h2>
        </div>
        <code class="feature-command">{feature.command}</code>
        <p>{feature.text}</p>
      </a>
    {/each}
  </div>
</section>

<style>
  .hero {
    padding: var(--sp-8) var(--sp-5) var(--sp-7);
    background:
      radial-gradient(circle at 85% -10%, var(--c-accent-soft), transparent 50%),
      radial-gradient(circle at 0% 100%, var(--c-bg-alt), transparent 60%),
      var(--c-bg);
    border-bottom: 1px solid var(--c-border);
  }

  .hero-grid {
    max-width: var(--wide-max);
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    gap: var(--sp-7);
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    color: var(--c-text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 10px;
    border-radius: 999px;
    box-shadow: var(--sh-sm);
    margin-bottom: var(--sp-5);
  }

  .badge .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: var(--c-good);
    border-radius: 999px;
  }

  .hero h1 {
    font-size: clamp(2.25rem, 4.2vw, var(--fs-4xl));
    line-height: 1.05;
    letter-spacing: -0.04em;
    margin: 0 0 var(--sp-5);
  }

  .accent {
    color: var(--c-accent);
  }

  .lede {
    font-size: var(--fs-md);
    color: var(--c-text-muted);
    max-width: 44ch;
    margin-bottom: var(--sp-6);
  }

  .lede strong {
    color: var(--c-text);
    font-family: var(--font-mono);
    font-weight: 600;
  }

  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-3);
    margin-bottom: var(--sp-5);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0.65rem 1.1rem;
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    font-weight: 500;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .btn.primary {
    background: var(--c-text);
    color: var(--c-bg);
    border-color: var(--c-text);
  }

  .btn.primary:hover {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: var(--c-accent-fg);
    text-decoration: none;
  }

  .btn.ghost {
    background: transparent;
    color: var(--c-text);
    border-color: var(--c-border-strong);
  }

  .btn.ghost:hover {
    background: var(--c-bg-alt);
    text-decoration: none;
  }

  .install {
    display: inline-block;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    padding: var(--sp-2) var(--sp-4);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--c-text);
    box-shadow: var(--sh-sm);
    margin: 0;
  }

  .install .prompt {
    color: var(--c-text-subtle);
    margin-right: var(--sp-2);
    user-select: none;
  }

  .hero-demo {
    min-width: 0;
  }

  .hero-demo :global(.demo) {
    margin: 0;
    box-shadow: var(--sh-lg);
  }

  .hero-demo :global(.demo-code) {
    font-size: var(--fs-xs);
    line-height: 1.65;
  }

  .features {
    padding: var(--sp-7) var(--sp-5) var(--sp-6);
  }

  .features-inner {
    max-width: var(--wide-max);
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-4);
  }

  .feature {
    display: block;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    padding: var(--sp-4) var(--sp-5) var(--sp-5);
    border-radius: var(--r-lg);
    color: inherit;
    text-decoration: none;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .feature:hover {
    border-color: var(--c-border-strong);
    box-shadow: var(--sh-md);
    text-decoration: none;
  }

  .feature-head {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .feature-icon {
    flex: none;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--c-bg-alt);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    color: var(--c-accent);
  }

  .feature-icon svg {
    width: 18px;
    height: 18px;
  }

  .feature h2 {
    font-size: var(--fs-md);
    margin: 0;
    letter-spacing: -0.02em;
  }

  .feature-command {
    display: inline-block;
    margin-bottom: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--c-accent);
  }

  .feature p {
    color: var(--c-text-muted);
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.6;
  }

  @media (max-width: 1100px) {
    .hero-grid {
      grid-template-columns: 1fr;
      gap: var(--sp-6);
    }

    .features-inner {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .hero {
      padding: var(--sp-6) var(--sp-4) var(--sp-6);
    }

    .hero h1 {
      font-size: clamp(2rem, 8.5vw, 2.6rem);
    }

    .features {
      padding: var(--sp-6) var(--sp-4) var(--sp-5);
    }

    .features-inner {
      grid-template-columns: 1fr;
    }
  }
</style>
