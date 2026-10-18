// Framework-agnostic host-contract helpers for plugin test suites. See ./vitest for a ready-made suite.
export {
  CLIENT_FORBIDDEN_PACKAGES,
  CLIENT_HOST_MODULES,
  DIRECT_MESSAGE_BYTES,
  HOOK_TIMEOUT_MS,
  RELAY_FRAME_BYTES,
  RPC_TIMEOUT_MS,
  SERVER_HOST_MODULES,
} from "./check/host.ts";
export { compileLikePaseo, compileWithHost, compileWithPaseo, findEntries, findPaseoApp, findPaseoHost, findPaseoSource, PASEO_SOURCE_MISSING } from "./check/compile.ts";
export type { PaseoApp, PaseoCompileResult, PaseoHost, Target } from "./check/compile.ts";
export {
  bundleRequires,
  chainStub,
  contributionIcons,
  disallowedClientRequires,
  disallowedServerRequires,
  evaluateClientBundle,
  evaluateServerBundle,
  sizeReport,
} from "./check/bundle.ts";
export type { ClientEvaluation, ClientEvaluationOptions, Handler, ServerEvaluation } from "./check/bundle.ts";
export { classSyntaxErrors, findHermes, hermesParse, hermesSmoke } from "./check/hermes.ts";
export { appIconNames, hostIconNames, iconListProblem, lucideIconNames, staticIconNames } from "./check/lucide.ts";
export { layoutMismatch, VERIFIED_PASEO } from "./compat.ts";
export { assertWithinRpcBudget, measureRpc, responseBytes } from "./check/budget.ts";
export type { RpcBudget, RpcMeasurement } from "./check/budget.ts";
export { checkClient, runChecks, formatResults } from "./check/index.ts";
export type { CheckOptions, CheckResult, ClientCheck } from "./check/index.ts";
