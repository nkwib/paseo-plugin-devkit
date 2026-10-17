import { platform } from "node:os";

let count = 0;

export function greet(name: string): { text: string; count: number } {
  count += 1;
  return { text: `Hello, ${name}! (from the plugin server on ${platform()})`, count };
}
