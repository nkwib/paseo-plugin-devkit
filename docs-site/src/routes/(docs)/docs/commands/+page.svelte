<script>
  import PageMeta from '#lib/components/PageMeta.svelte';
  import commands from '#lib/commands.json';
  import { meta } from '#lib/generated/meta.js';
  import { blob } from '#lib/site.js';

  // commands.json stores the devkit version as a token, so a version bump alone does not change the file.
  const fill = (text) => text.replaceAll(commands.versionToken, meta.version);
  const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
</script>

<PageMeta
  title="Commands"
  description="Every ppd command with its options, generated from the CLI's own help text: create, daemon, install, dev, paseo, web, android, doctor, check, release and registry."
/>

<h1>Commands</h1>

<p class="lede">
  Every command and option, generated from <code>ppd --help</code> and <code>ppd help &lt;command&gt;</code> by
  <a href={blob('docs-site/scripts/gen-commands.mjs')} target="_blank" rel="noopener">a script</a>. CI fails when this
  page and the CLI disagree.
</p>

<table class="index">
  <thead>
    <tr><th>Command</th><th>What it does</th></tr>
  </thead>
  <tbody>
    {#each commands.sections as section (section.title)}
      {#each section.commands as command (command.topic)}
        <tr>
          <td><a href="#{command.topic}"><code>{command.usage}</code></a></td>
          <td>{command.summary}</td>
        </tr>
      {/each}
    {/each}
  </tbody>
</table>

{#each commands.sections as section (section.title)}
  <h2 id={slug(section.title)}>{section.title}</h2>
  {#if section.note}<p class="note">{section.note[0].toUpperCase() + section.note.slice(1)}.</p>{/if}
  {#each section.commands as command (command.topic)}
    <h3 id={command.topic}><code>{command.usage}</code></h3>
    <pre class="code-block help" data-lang=""><code>{fill(command.help)}</code></pre>
  {/each}
{/each}

<h2 id="exit-codes">Exit codes</h2>

<table>
  <thead>
    <tr><th>Code</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>0</code></td><td>Success. <code>ppd check</code> passes with warnings and skips.</td></tr>
    <tr>
      <td><code>1</code></td>
      <td>
        A failed check, a plugin that is not running or whose client the app would reject (<code>install</code>), a plugin
        client the app failed to evaluate (<code>web</code>), device warnings (<code>android status</code>), a missing tool
        (<code>doctor</code>), or a usage error.
      </td>
    </tr>
    <tr>
      <td><code>3</code></td>
      <td>A safety refusal, printed as <code>refused: ...</code>: port 6767, a home overlapping <code>~/.paseo</code>, <code>--home</code> or <code>--host</code> passed to <code>ppd paseo</code>. Nothing was started or changed.</td>
    </tr>
  </tbody>
</table>

<p><code>ppd paseo</code> exits with the Paseo CLI's own code.</p>

<style>
  .help {
    font-size: var(--fs-xs);
    line-height: 1.6;
  }

  h3 {
    margin-top: var(--sp-6);
  }

  h3 code {
    font-size: 0.95em;
    background: transparent;
    border: 0;
    padding: 0;
  }

  .note {
    color: var(--c-text-muted);
  }

  .index td:first-child {
    white-space: nowrap;
  }
</style>
