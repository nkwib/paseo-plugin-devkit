// The fake agent can run real shell commands (`bash` with `run: true`, also from a cwd's .fake-agent.json). That is
// only safe in a throwaway dev daemon, so it is allowed only when the daemon's home carries the marker ppd writes
// into every home it creates. The plugin process inherits the daemon's environment, and ppd starts its daemons with
// PASEO_HOME set to that home; a daemon the user runs has no marker, so a plain `paseo plugin install` gets refusals.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Must equal HOME_MARKER in the devkit's src/safety.ts (test/review-devkit-safety.test.ts checks it). */
export const PPD_HOME_MARKER = ".ppd-home";

/** Why shell steps are refused in this daemon, or null when it is a ppd dev daemon. */
export function shellRefusal(env: NodeJS.ProcessEnv = process.env): string | null {
  const home = env.PASEO_HOME;
  if (home && existsSync(join(home, PPD_HOME_MARKER))) return null;
  return "fake-agent refused to run this command: bash steps with run: true work only in a dev daemon started by `ppd daemon up`, and this daemon's home was not created by ppd";
}
