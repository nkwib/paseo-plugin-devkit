// Portions adapted from Paseo (https://github.com/getpaseo/paseo) at commit 9bd58f66b2dfc195898bf1178e84f02933c0d41e:
//   packages/server/src/server/plugins/manifest.ts
//   packages/protocol/src/plugin-config.ts
//   packages/protocol/src/plugin-requirements.ts
// Copyright (c) 2025-present Mohamed Boudra. Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.
// Modified: the zod schemas are rewritten as plain checks that return errors and warnings instead of throwing, and
// unknown top-level keys produce a warning.
//
// paseo-plugin.json rules. Paseo's schema is a non-strict z.object, so unknown keys such as `$comment` (written
// by `paseo plugin init`) are ignored, while `requirements` is strict so a misspelled requirement cannot
// silently disable the compatibility check.
import validRange from "semver/ranges/valid.js";

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const KNOWN_KEYS = new Set(["id", "name", "description", "icon", "media", "requirements", "build"]);

/** PluginAssetPathSchema: forward slashes, inside the package, no query or control characters. */
export function isAssetPath(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.trim() &&
    !value.startsWith("/") &&
    !/[\\:?#\p{Cc}]/u.test(value) &&
    !value.split("/").includes("..") &&
    !value.endsWith("/") &&
    value.split("/").at(-1) !== "."
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export interface ManifestFindings {
  errors: string[];
  warnings: string[];
}

/** What Paseo's readPluginManifest would reject (errors) plus likely typos it silently ignores (warnings). */
export function manifestFindings(manifest: unknown): ManifestFindings {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { errors: ["paseo-plugin.json must be a JSON object"], warnings };
  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== "string" || !m.id) errors.push("missing id");
  else if (!PLUGIN_ID.test(m.id)) errors.push(`id ${JSON.stringify(m.id)} must match /^[a-z][a-z0-9-]*$/ (lowercase letters, digits, dashes)`);
  for (const key of ["name", "description"]) {
    if (m[key] !== undefined && (typeof m[key] !== "string" || !(m[key] as string).trim())) errors.push(`${key} must be a non-empty string`);
  }
  if (m.icon !== undefined) {
    if (typeof m.icon !== "string" || !isAssetPath(m.icon)) errors.push("icon must be a relative file path inside the plugin package");
    else if (!/\.png$/i.test(m.icon)) errors.push(`icon ${m.icon} must be a PNG`);
  }
  if (m.media !== undefined) {
    if (!Array.isArray(m.media)) errors.push("media must be a list of package paths or https URLs");
    else for (const entry of m.media) {
      if (typeof entry !== "string" || (!isAssetPath(entry) && !isHttpsUrl(entry))) errors.push(`media entry ${JSON.stringify(entry)} must be a relative package path or an https URL`);
    }
  }

  const requirements = m.requirements;
  if (requirements === undefined) {
    // Valid for Paseo's schema, but the daemon then treats the plugin as pre-0.8 and refuses it.
    errors.push('missing requirements.paseo: without it Paseo treats the plugin as pre-0.8 and refuses it (use e.g. ">=0.11.2")');
  } else if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    errors.push("requirements must be an object");
  } else {
    const r = requirements as Record<string, unknown>;
    for (const key of Object.keys(r)) if (key !== "paseo") errors.push(`unknown requirement ${JSON.stringify(key)}: requirements is strict and accepts only "paseo"`);
    if (r.paseo === undefined) errors.push("missing requirements.paseo");
    else if (typeof r.paseo !== "string" || !r.paseo.trim() || validRange(r.paseo) === null) {
      errors.push(`invalid requirements.paseo ${JSON.stringify(r.paseo)}: use an npm semver range such as ">=0.11.2"`);
    }
  }

  if (m.build !== undefined) {
    const valid =
      Array.isArray(m.build) &&
      m.build.length > 0 &&
      m.build.every((argv) => Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === "string" && part.trim().length > 0));
    if (!valid) errors.push('build must be a non-empty list of argv arrays, e.g. [["npm", "ci", "--omit=dev", "--ignore-scripts"]]; shell strings are rejected');
  }

  for (const key of Object.keys(m)) {
    if (!KNOWN_KEYS.has(key) && !key.startsWith("$")) warnings.push(`unknown key ${JSON.stringify(key)} is ignored by Paseo (typo?)`);
  }
  return { errors, warnings };
}
