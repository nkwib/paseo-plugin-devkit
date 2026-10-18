// The devkit's own version, from its package.json (one level above both src/ and dist/).
import { readFileSync } from "node:fs";

export const DEVKIT_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
