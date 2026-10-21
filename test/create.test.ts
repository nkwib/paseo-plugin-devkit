import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runChecks } from "../src/check/index.ts";
import { createPlugin, displayName, TEMPLATES, type Template } from "../src/create.ts";
import { findPaseoBin } from "../src/paseo.ts";
import { DEVKIT_VERSION } from "../src/version.ts";
import { ROOT, scratch } from "./helpers.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hasPaseo = findPaseoBin() !== null;

function failures(results: Awaited<ReturnType<typeof runChecks>>) {
  return results.filter((result) => result.status === "fail").map((result) => `${result.id}: ${result.message} ${result.details?.join(" ") ?? ""}`);
}

describe("ppd create", () => {
  it("names plugins from their id", () => {
    expect(displayName("agent-hook-demo")).toBe("Agent hook demo");
  });

  it.each(TEMPLATES)("the built-in base plus the %s template passes check and has the files init leaves out", async (template: Template) => {
    const dir = join(scratch("ppd-create-"), `my-${template}`);
    const result = await createPlugin(dir, { template, paseo: null });
    expect(result).toMatchObject({ id: `my-${template}`, template, base: "built-in" });
    expect(result.files).toEqual(expect.arrayContaining([".gitignore", "README.md", "vitest.config.ts", "test/host-contract.test.ts", "index.client.tsx", "index.server.ts"]));

    const pkg = json(join(dir, "package.json"));
    expect(pkg.scripts).toMatchObject({ check: "ppd check", test: "vitest run", typecheck: "tsc --noEmit", dev: "ppd dev" });
    const typesNode = json(join(ROOT, "package.json")).devDependencies["@types/node"];
    expect(typesNode).toMatch(/^~22\./); // 26 broke plugin installs (getpaseo/paseo#7145)
    expect(pkg.devDependencies).toMatchObject({ "@types/node": typesNode, "paseo-plugin-devkit": `^${DEVKIT_VERSION}` });
    expect(pkg.devDependencies.vitest).toBeTruthy();
    expect(json(join(dir, "tsconfig.json")).compilerOptions.types).toEqual(["react", "node"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(readFileSync(join(dir, "README.md"), "utf8")).not.toContain("{{");
    expect(json(join(dir, "paseo-plugin.json"))).toMatchObject({ id: `my-${template}`, name: `My ${template.replace("-", " ")}` });

    expect(failures(await runChecks(dir))).toEqual([]);
  }, 180_000);

  it("the panel template is the hello-plugin panel and RPC", async () => {
    const dir = join(scratch("ppd-create-"), "hello");
    await createPlugin(dir, { paseo: null });
    expect(readFileSync(join(dir, "shared/rpc.ts"), "utf8")).toContain('name: "hello.greet"');
    expect(existsSync(join(dir, "client/hello-panel.tsx"))).toBe(true);
  });

  it("the agent-hook template listens to turn_ended, renders a card and pins the SDK type packages", async () => {
    const dir = join(scratch("ppd-create-"), "hook");
    await createPlugin(dir, { template: "agent-hook", paseo: null, devkit: "file:../devkit" });
    expect(readFileSync(join(dir, "index.server.ts"), "utf8")).toContain('server.on("agent.turn_ended"');
    expect(readFileSync(join(dir, "client/summary-card.tsx"), "utf8")).toContain("client.openScreen(");
    const deps = json(join(dir, "package.json")).devDependencies;
    expect(deps["@getpaseo/client"]).toBe(deps["@getpaseo/plugin"]);
    expect(deps["@getpaseo/protocol"]).toBe(deps["@getpaseo/plugin"]);
    expect(deps["paseo-plugin-devkit"]).toBe("file:../devkit");
  });

  it.skipIf(!hasPaseo)("wraps paseo plugin init when the CLI has it", async () => {
    const dir = join(scratch("ppd-create-"), "from-init");
    const result = await createPlugin(dir, { template: "agent-hook" });
    expect(result.base).toBe("paseo plugin init");
    const manifest = json(join(dir, "paseo-plugin.json"));
    expect(manifest.$comment).toBeTruthy();
    expect(manifest.$comment).not.toContain('"name"');
    expect(existsSync(join(dir, "client/greeting.tsx"))).toBe(false);
    expect(failures(await runChecks(dir))).toEqual([]);
  }, 180_000);

  it("refuses a non-empty directory and an invalid id", async () => {
    const dir = scratch("ppd-create-");
    mkdirSync(join(dir, "full"));
    writeFileSync(join(dir, "full/file.txt"), "x");
    await expect(createPlugin(join(dir, "full"), { paseo: null })).rejects.toThrow(/not empty/);
    await expect(createPlugin(join(dir, "Bad_Id"), { paseo: null })).rejects.toThrow(/invalid plugin id/);
  });
});
