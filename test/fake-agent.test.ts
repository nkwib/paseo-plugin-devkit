import { describe, expect, it } from "vitest";
import { runChecks } from "../src/check/index.ts";
import { FAKE_AGENT_DIR, fakeAgentPrompt, type FakeScript as DevkitScript } from "../src/fake-agent.ts";
import {
  defaultScript,
  parseScript,
  scriptFromPrompt,
  scriptFromTurnsFile,
  type FakeScript as PluginScript,
} from "../assets/fake-agent/server/script.ts";

// The devkit's FakeScript mirrors the plugin's: this fails the typecheck when they drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const scriptTypesMatch: Same<DevkitScript, PluginScript> = true;

describe("fake agent script", () => {
  it("keeps the devkit and plugin script types in sync", () => {
    expect(scriptTypesMatch).toBe(true);
  });

  it("reads a script from a JSON prompt, a bare step array or a fenced block", () => {
    const steps = [{ write: { path: "a.txt", content: "x" } }, { say: "done" }];
    expect(scriptFromPrompt(fakeAgentPrompt(steps))).toEqual({ steps });
    expect(scriptFromPrompt(JSON.stringify(steps))).toEqual({ steps });
    expect(scriptFromPrompt(`please\n\`\`\`fake-agent\n${JSON.stringify({ steps, stepDelayMs: 5 })}\n\`\`\``)).toEqual({ steps, stepDelayMs: 5 });
  });

  it("treats plain prompts as no script and echoes them", () => {
    expect(scriptFromPrompt("hello there")).toBeNull();
    expect(defaultScript("hello")).toEqual({ steps: [{ say: "fake-agent received: hello" }] });
  });

  it("rejects malformed steps with the step index", () => {
    expect(() => parseScript({ steps: [{ say: "a" }, { say: "b", think: "c" }] })).toThrow(/step 1/);
    expect(() => parseScript({ steps: [{ teleport: 1 }] })).toThrow(/exactly one of/);
    expect(() => scriptFromPrompt("{ not json")).toThrow();
  });

  it("picks turn N from a turns file and repeats the last", () => {
    const file = JSON.stringify({ turns: [[{ say: "one" }], [{ say: "two" }]] });
    expect(scriptFromTurnsFile(file, 1)).toEqual({ steps: [{ say: "one" }] });
    expect(scriptFromTurnsFile(file, 5)).toEqual({ steps: [{ say: "two" }] });
  });

  it("the fake agent plugin passes ppd check", async () => {
    const failed = (await runChecks(FAKE_AGENT_DIR)).filter((result) => result.status === "fail");
    expect(failed).toEqual([]);
  }, 120_000);
});
