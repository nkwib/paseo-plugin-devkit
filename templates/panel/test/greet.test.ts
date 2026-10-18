import { describe, expect, it } from "vitest";
import { greet } from "../server/greet";

describe("greet", () => {
  it("greets by name and counts calls", () => {
    const first = greet("Ada");
    expect(first.text).toContain("Hello, Ada!");
    expect(greet("Ada").count).toBe(first.count + 1);
  });
});
