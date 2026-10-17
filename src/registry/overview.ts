// OVERVIEW.md lint against the registry's listing rules (getpaseo/plugins README, REVIEW.md and the
// publishing guide): no install commands, no em dashes, sentence case, no badges or boilerplate sections,
// HTTPS-only absolute links because the overview renders without raw HTML or relative URLs.

export interface LintFinding {
  level: "error" | "warn";
  line: number;
  message: string;
}

const INSTALL_COMMANDS = [/paseo\s+plugin\s+(add|install)\b/i, /\bnpm\s+(install|i)\b/i, /\b(pnpm|yarn|bun)\s+add\b/i];
const BOILERPLATE = /^(install(ation)?|changelog|change log|contributing|license|licence|badges?)$/i;
/** Words that stay capitalized inside a sentence-case heading. Extend with --allow. */
export const DEFAULT_PROPER_NOUNS = [
  "Paseo", "GitHub", "Git", "npm", "macOS", "iOS", "Android", "Linux", "Windows", "Claude", "Codex", "OpenAI", "Anthropic",
  "PDF", "Word", "Excel", "PowerPoint", "Office", "Markdown", "JSON", "API", "CLI", "MCP", "URL", "HTTP", "HTTPS",
  "I", "React", "Native", "Node", "TypeScript", "JavaScript", "Slack", "Jira", "Linear", "Docker", "Kubernetes",
];

/** Words in a heading, minus the first, that look title-cased rather than proper nouns or acronyms. */
export function titleCaseWords(heading: string, properNouns: readonly string[] = DEFAULT_PROPER_NOUNS): string[] {
  const words = heading
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const known = new Set(properNouns);
  return words.slice(1).filter((word) => {
    if (known.has(word)) return false;
    if (!/^\p{Lu}/u.test(word)) return false;
    if (/^[\p{Lu}\d]+s?$/u.test(word)) return false;
    if (/\d/.test(word) || /\p{Ll}\p{Lu}/u.test(word)) return false;
    return true;
  });
}

export function lintOverview(text: string, properNouns: readonly string[] = DEFAULT_PROPER_NOUNS): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = text.split("\n");
  let fence = false;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.includes("—")) findings.push({ level: "error", line, message: "em dash: use a colon, comma, parentheses or a period" });
    for (const pattern of INSTALL_COMMANDS) {
      if (pattern.test(raw)) findings.push({ level: "error", line, message: `install command (${raw.match(pattern)![0]}): the listing already shows installation; link to your README` });
    }
    if (raw.includes("<!--")) findings.push({ level: "error", line, message: "HTML comment (template leftover?)" });
    if (/^\s*```/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    if (/img\.shields\.io|badge\.fury\.io|\/badge\.svg/.test(raw)) findings.push({ level: "warn", line, message: "badge: omit badges from the overview" });
    if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(raw.replace(/`[^`]*`/g, ""))) findings.push({ level: "warn", line, message: "raw HTML is not rendered" });
    for (const match of raw.matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
      const url = match[1]!;
      if (url.startsWith("#")) continue;
      if (!/^https:\/\//i.test(url)) findings.push({ level: "warn", line, message: `link or image ${url}: only absolute HTTPS URLs render` });
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) {
      const title = heading[1]!;
      if (BOILERPLATE.test(title.trim())) findings.push({ level: "warn", line, message: `"${title}" section: omit installation, changelog, contributing and license sections` });
      const capitalized = titleCaseWords(title, properNouns);
      if (capitalized.length) findings.push({ level: "warn", line, message: `heading "${title}" looks title-cased (${capitalized.join(", ")}): use sentence case` });
    }
  });
  if (!text.trim()) findings.push({ level: "error", line: 1, message: "overview is empty" });
  return findings;
}
