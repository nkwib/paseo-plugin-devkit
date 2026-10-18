// What ppd assumes about an installed Paseo (where the app bundle keeps its modules, how the daemon starts, which
// labels the web UI uses), and the message it prints when an assumption no longer holds. These assumptions were
// verified on one Paseo release; a different release may move things.

/** The Paseo release whose app layout, daemon flags and web UI labels ppd was verified on. */
export const VERIFIED_PASEO = "0.11.4";

export const ISSUES_URL = "https://github.com/nkwib/paseo-plugin-devkit/issues";

/**
 * A message for a Paseo install that does not look the way ppd expects: what failed, what ppd looked for, how the
 * found version relates to the verified one, and what to do instead.
 */
export function layoutMismatch(problem: string, expected: string, version: string | null | undefined, next: string): string {
  const seen =
    version === VERIFIED_PASEO
      ? `This is Paseo ${VERIFIED_PASEO}, the version ppd was verified on, so the install may be incomplete.`
      : `ppd was verified on Paseo ${VERIFIED_PASEO}${version ? ` and found ${version}` : ""}, so this release may lay things out differently.`;
  return `${problem}: expected ${expected}. ${seen} ${next}. Please report it at ${ISSUES_URL}`;
}

/** A one-line note for `ppd doctor` and `ppd daemon up` when the Paseo version differs from the verified one. */
export function versionNote(version: string | null | undefined): string | null {
  const found = version?.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0];
  if (!found) return null;
  return found === VERIFIED_PASEO ? null : `ppd was verified on Paseo ${VERIFIED_PASEO}; this is ${found}`;
}
