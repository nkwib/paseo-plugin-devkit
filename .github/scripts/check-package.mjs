// Checks the npm tarball before a release: the license files and the Apache-2.0 notices ship, the notices survive
// compilation, and nothing internal (tests, the docs site, CI config) does. Run after `npm run build`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }));
const files = new Set(pack.files.map((file) => file.path));
const problems = [];

const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES",
  "CHANGELOG.md",
  "dist/cli.js",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/testing.js",
  "dist/vitest.js",
  "dist/web.js",
  "scripts/host-compile.mjs",
  "scripts/host-timeline.mjs",
  "assets/fake-agent/paseo-plugin.json",
  "skills/paseo-plugin-dev/SKILL.md",
  "examples/hello-plugin/paseo-plugin.json",
  "templates/common/gitignore",
];
for (const file of required) if (!files.has(file)) problems.push(`missing from the tarball: ${file}`);

for (const file of files) {
  if (/^(test|docs-site|docs|src|\.github|node_modules)\//.test(file)) problems.push(`should not ship: ${file}`);
}

// Every adapted file listed in THIRD_PARTY_NOTICES ships with its notice (src/*.ts as the compiled dist/*.js).
const adapted = [...readFileSync("THIRD_PARTY_NOTICES", "utf8").matchAll(/^ {2}((?:src|assets)\/\S+)$/gm)].map((m) => m[1]);
if (adapted.length === 0) problems.push("THIRD_PARTY_NOTICES lists no adapted files");
for (const source of adapted) {
  const shipped = source.startsWith("src/") ? source.replace(/^src\//, "dist/").replace(/\.ts$/, ".js") : source;
  if (!files.has(shipped)) {
    problems.push(`adapted file not in the tarball: ${shipped}`);
    continue;
  }
  if (!readFileSync(shipped, "utf8").startsWith("// Portions adapted from Paseo")) problems.push(`${shipped} lost its origin notice`);
}

const limit = 2 * 1024 * 1024;
if (pack.unpackedSize > limit) problems.push(`unpacked size ${pack.unpackedSize} bytes is over ${limit}`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${pack.name}@${pack.version}: ${pack.entryCount} files, ${pack.size} bytes packed, ${pack.unpackedSize} unpacked; notices on ${adapted.length} adapted files`);
