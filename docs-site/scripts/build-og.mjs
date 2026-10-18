#!/usr/bin/env node
// Rasterizes static/og.svg to static/og.png, the social card app.html points at. Fonts come from the system
// (Inter and JetBrains Mono when installed, else the fallbacks named in the SVG), so run it on a machine with
// both installed for the intended typography, and commit the PNG.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(site, 'static/og.svg'), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
writeFileSync(resolve(site, 'static/og.png'), png);
console.log(`wrote static/og.png (${png.length} bytes)`);
