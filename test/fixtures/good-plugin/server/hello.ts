import { readFileSync } from "node:fs";

export function hello(input: { who: string }): { text: string } {
  void readFileSync;
  return { text: `hello ${input.who}` };
}
