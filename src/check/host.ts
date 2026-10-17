// The Paseo plugin host contract as code. Sources: public-docs/plugins/reference.md (client runtime),
// packages/server/src/server/plugins (compiler.ts, plugin-sdk-specifiers.ts, runtime.ts), Paseo 0.11.
import { builtinModules } from "node:module";

export const SDK_SHARED = ["@getpaseo/plugin"] as const;
export const SDK_SERVER_ONLY = [
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
] as const;
export const SDK_CLIENT_ONLY = ["@getpaseo/plugin/client", "@getpaseo/plugin/client/ui", "@getpaseo/plugin/client/react-native"] as const;
export const SDK_SPECIFIERS = [...SDK_SHARED, ...SDK_SERVER_ONLY, ...SDK_CLIENT_ONLY] as const;

/** The only modules a client bundle may require at runtime. Anything else throws `Module "<name>" is not available in plugin client code`. */
export const CLIENT_HOST_MODULES = [
  ...SDK_SHARED,
  ...SDK_CLIENT_ONLY,
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
] as const;

/** Server bundles get these from the host; other bare requires resolve from Paseo's install, not the plugin. */
export const SERVER_HOST_MODULES = [...SDK_SHARED, ...SDK_SERVER_ONLY, "zod"] as const;

/** Packages that need native modules or the DOM. The host does not provide them to plugins. */
export const CLIENT_FORBIDDEN_PACKAGES: Record<string, string> = {
  "react-native-gesture-handler": "no gesture-handler for plugins: build gestures from responder events",
  "react-native-reanimated": "not provided to plugins: use Animated from react-native",
  "react-native-safe-area-context": "safe-area insets are not exported to plugin panels (getpaseo/paseo#5866)",
  "lucide-react-native": "set contribution `icon` to a Lucide name or use Icon from @getpaseo/plugin/client/react-native",
  "react-native-svg": "not provided to plugins",
  "react-dom": "client code runs on iOS and Android too: no DOM",
  "@getpaseo/plugin/client/host": "private to the app host",
};

/** Plugin RPC handlers time out after 30 s (runtime.ts REQUEST_TIMEOUT_MS). Handlers get no abort signal. */
export const RPC_TIMEOUT_MS = 30_000;
/** Hooks also time out after 30 s, and do get `context.signal`. */
export const HOOK_TIMEOUT_MS = 30_000;
/** Direct websocket message cap (@getpaseo/protocol websocket-message-limit). */
export const DIRECT_MESSAGE_BYTES = 100 * 1024 * 1024;
/** Budget for clients behind the Cloudflare-hosted relay, which caps WebSocket messages at 32 MiB. Encrypted framing adds overhead, so stay well under. */
export const RELAY_FRAME_BYTES = 32 * 1024 * 1024;

export function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return specifier.startsWith("node:") || builtinModules.includes(bare) || builtinModules.includes(bare.split("/")[0]!);
}

export function packageName(specifier: string): string {
  return specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

export function isHostClientModule(specifier: string): boolean {
  return (CLIENT_HOST_MODULES as readonly string[]).includes(specifier);
}

export function isHostServerModule(specifier: string): boolean {
  return (SERVER_HOST_MODULES as readonly string[]).includes(specifier);
}

/** Host-provided for typechecking only: these belong in devDependencies. */
export function isHostProvidedPackage(name: string): boolean {
  return /^(@getpaseo\/plugin|zod|react|react-native|@tanstack\/react-query|react\/jsx-runtime)$/.test(name);
}
