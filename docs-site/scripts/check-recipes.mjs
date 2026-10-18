#!/usr/bin/env node
// Runs `ppd check` on every recipe plugin in recipes/, so the code the recipe pages show keeps passing the
// host-contract checks. Uses the devkit sources in this repository (Node 22.18+ runs them directly). Extra
// arguments go to `ppd check`; without the Paseo app (CI) the compile is the labeled approximation.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(site, '../src/cli.ts');
const recipes = join(site, 'recipes');
const failed = [];
for (const name of readdirSync(recipes).sort()) {
  const dir = join(recipes, name);
  if (!statSync(dir).isDirectory()) continue;
  console.log(`--- ppd check recipes/${name}`);
  const result = spawnSync(process.execPath, [cli, 'check', dir, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.status !== 0) failed.push(name);
}
if (failed.length) {
  console.error(`ppd check failed for: ${failed.join(', ')}`);
  process.exit(1);
}
