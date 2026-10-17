import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const helloRpc = defineRpc({ name: "hello.get", input: z.object({ who: z.string() }), output: z.object({ text: z.string() }) });
