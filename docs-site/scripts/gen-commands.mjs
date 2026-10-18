#!/usr/bin/env node
// Regenerates src/lib/commands.json from the CLI's own help text (`ppd --help`, then `ppd help <command>` for
// every command it lists), so the Commands page cannot drift from the CLI. CI fails when the committed file
// differs. The devkit version is stored as a token and filled in at render time, so a version bump alone
// does not change the file.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(site, '..');
const VERSION_TOKEN = '{{version}}';
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

const ppd = (...args) =>
  execFileSync(process.execPath, [resolve(root, 'src/cli.ts'), ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
    .trimEnd()
    .replaceAll(`^${version}`, `^${VERSION_TOKEN}`);

const top = ppd('--help');
const sections = [];
for (const line of top.split('\n')) {
  const heading = line.match(/^(\S.*?)(?: \((.+)\))?$/);
  const entry = line.match(/^ {2}(\S+)(.*?)\s{2,}(\S.*)$/);
  if (entry && sections.length) {
    const [, topic, rest, summary] = entry;
    const help = ppd('help', topic);
    if (help === top) throw new Error(`ppd help ${topic} printed the top-level help: give the command its own help text`);
    sections.at(-1).commands.push({ topic, usage: `ppd ${topic}${rest}`.trimEnd(), summary, help });
  } else if (heading && !line.startsWith('Usage') && !line.startsWith('Docs:') && !line.startsWith('ppd:') && !line.startsWith('       ')) {
    sections.push({ title: heading[1], note: heading[2] ?? null, commands: [] });
  }
}
const used = sections.filter((section) => section.commands.length);
if (used.length < 3) throw new Error(`could not parse \`ppd --help\` (found ${used.length} sections)`);

const out = resolve(site, 'src/lib/commands.json');
writeFileSync(out, `${JSON.stringify({ source: 'ppd --help and ppd help <command>', versionToken: VERSION_TOKEN, top, sections: used }, null, 2)}\n`);
console.log(`[gen-commands] ${used.flatMap((s) => s.commands).length} commands in ${used.length} sections -> src/lib/commands.json`);
