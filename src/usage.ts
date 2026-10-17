/** A malformed command line. The CLI prints the message plus a pointer to the command's --help. */
export class UsageError extends Error {
  override name = "UsageError";
}
