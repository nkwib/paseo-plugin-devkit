import { describe, expect, it } from "vitest";
import { lintOverview, titleCaseWords } from "../src/registry/overview.ts";

describe("OVERVIEW lint", () => {
  it("flags em dashes and install commands as errors", () => {
    const findings = lintOverview("Views PDFs \u2014 fast.\n\nRun `paseo plugin add acme/x` or npm install x.\n");
    expect(findings.filter((f) => f.level === "error").map((f) => f.line)).toEqual([1, 3, 3]);
  });

  it("flags title case headings but allows proper nouns and acronyms", () => {
    expect(titleCaseWords("Works With GitHub And PDF Files")).toEqual(["With", "And", "Files"]);
    expect(titleCaseWords("Data sent to OpenAI and GitHub")).toEqual([]);
    expect(titleCaseWords("Setup on macOS, iOS and Android")).toEqual([]);
    const findings = lintOverview("# Hello\n\n## How It Works\n\ntext\n");
    expect(findings).toEqual([expect.objectContaining({ level: "warn", line: 3 })]);
  });

  it("warns on badges, boilerplate sections, raw HTML and non-HTTPS links", () => {
    const text = "![ci](https://img.shields.io/x.svg)\n\n## License\n\n<details>x</details>\n\nSee [docs](./docs.md) and [site](http://x.dev).\n";
    const messages = lintOverview(text).map((f) => f.message);
    expect(messages.some((m) => m.includes("badge"))).toBe(true);
    expect(messages.some((m) => m.includes("License"))).toBe(true);
    expect(messages.some((m) => m.includes("raw HTML"))).toBe(true);
    expect(messages.filter((m) => m.includes("only absolute HTTPS")).length).toBe(2);
  });

  it("ignores code fences for headings and HTML but still flags install commands inside them", () => {
    const findings = lintOverview("Intro.\n\n```\n# Not A Heading\n<div>\nnpm i thing\n```\n");
    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining("install command")]);
  });

  it("passes a clean overview", () => {
    expect(lintOverview("Shows documents inside Paseo.\n\n## How it works\n\nThe server renders pages.\n")).toEqual([]);
  });
});
