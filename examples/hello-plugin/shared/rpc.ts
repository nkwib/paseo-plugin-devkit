import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const greetRpc = defineRpc({
  name: "hello.greet",
  input: z.object({ name: z.string().min(1).max(100) }),
  output: z.object({ text: z.string(), count: z.number().int() }),
});
