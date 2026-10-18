import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One document per Paseo host, shared by every client of that host. Defaults make `{}` a complete document. */
export const preferences = defineSettings({
  id: "alerts",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    turns: z.enum(["failed", "all"]).default("failed"),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;
