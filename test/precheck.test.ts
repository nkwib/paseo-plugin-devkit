import { cpSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFindings, mediaFindings, precheck } from "../src/registry/precheck.ts";
import { EXAMPLE, scratch } from "./helpers.ts";

function plugin(): string {
  const dir = join(scratch("ppd-pre-"), "p");
  cpSync(EXAMPLE, dir, { recursive: true, filter: (source) => !source.includes("node_modules") });
  return dir;
}

describe("media and icon", () => {
  it("accepts the fixture assets", () => {
    const dir = plugin();
    expect(mediaFindings(dir, { icon: "assets/icon.png", media: ["assets/screenshot.png", "https://example.com/demo.mp4"] }, null)).toEqual([]);
  });

  it("requires an image somewhere in media, not first (the thumbnail is the first image, PROTOCOL.md)", () => {
    const dir = plugin();
    expect(mediaFindings(dir, { media: ["https://example.com/demo.mp4"] }, null).map((f) => f.message)).toEqual(["media has no image: the card thumbnail is the first image entry"]);
  });

  it("reports malformed media instead of crashing", () => {
    const dir = plugin();
    expect(mediaFindings(dir, { media: "assets/screenshot.png" as never }, null).map((f) => f.message)).toEqual(["media must be a list of package paths or HTTPS URLs"]);
    expect(mediaFindings(dir, { media: ["https://"] }, null).map((f) => f.message)).toContain("https://: not a valid URL");
  });

  it("rejects SVG, extensionless URLs, missing files and escaping paths", () => {
    const dir = plugin();
    const messages = mediaFindings(dir, { icon: "assets/icon.svg", media: ["https://example.com/demo.mp4", "assets/missing.png", "../outside.png", "https://example.com/image", "http://example.com/a.png"] }, { files: ["paseo-plugin.json"] }).map((f) => `${f.level} ${f.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^error assets\/missing.png: file does not exist/),
        expect.stringMatching(/^error \.\.\/outside.png: path leaves/),
        expect.stringMatching(/^error https:\/\/example.com\/image: extension/),
        expect.stringMatching(/^error http:\/\/example.com\/a.png: media URLs must be HTTPS/),
        expect.stringMatching(/^error assets\/icon.svg: the listing icon must be a PNG/),
        expect.stringMatching(/^warn assets\/missing.png: not in package.json files/),
      ]),
    );
  });
});

describe("build and lockfile", () => {
  it("requires a lockfile and an npm ci build for runtime dependencies", () => {
    const dir = plugin();
    const messages = buildFindings({}, { dependencies: { pngjs: "^7.0.0" } }, dir).map((f) => f.message);
    expect(messages.some((m) => m.includes("without package-lock.json"))).toBe(true);
    expect(messages.some((m) => m.includes("no build"))).toBe(true);
  });

  it("rejects shell-string builds and nudges npm install toward npm ci flags", () => {
    const dir = plugin();
    expect(buildFindings({ build: "npm ci" as never }, null, dir)[0]!.message).toMatch(/argv arrays/);
    const messages = buildFindings({ build: [["npm", "install"], ["npm", "ci"]] }, null, dir).map((f) => f.message);
    expect(messages).toEqual([expect.stringMatching(/use npm ci/), expect.stringMatching(/--omit=dev/), expect.stringMatching(/--ignore-scripts/)]);
  });

  it("detects a lockfile out of sync with package.json", () => {
    const dir = plugin();
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { pngjs: "^6.0.0" } } } }));
    const findings = buildFindings({ build: [["npm", "ci", "--omit=dev", "--ignore-scripts"]] }, { dependencies: { pngjs: "^7.0.0" } }, dir);
    expect(findings.map((f) => f.message)).toEqual([expect.stringMatching(/out of sync for pngjs/)]);
  });
});

describe("precheck", () => {
  it("passes the example plugin apart from Git placement", () => {
    const findings = precheck(plugin()).filter((f) => f.level === "error" && f.area !== "git");
    expect(findings).toEqual([]);
  });

  it("reports a missing overview as a warning, not an error", () => {
    const dir = plugin();
    rmSync(join(dir, "OVERVIEW.md"));
    expect(precheck(dir).find((f) => f.area === "overview")).toMatchObject({ level: "warn" });
  });
});
