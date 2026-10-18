// Every `ppd check` result as a test: compile and evaluate with the installed Paseo app (or the
// labeled approximation in CI), the app's registration rules, icons, bundle size.
import { fileURLToPath } from "node:url";
import { describeHostContract } from "paseo-plugin-devkit/vitest";

describeHostContract(fileURLToPath(new URL("..", import.meta.url)));
