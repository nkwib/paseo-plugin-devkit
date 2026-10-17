// RPC budget helpers. Paseo times plugin RPCs out after 30 s and gives handlers no abort signal, so a slow
// handler keeps running (and holding memory) after the client has given up. Test worst-case fixtures with margin.
import { RELAY_FRAME_BYTES, RPC_TIMEOUT_MS } from "./host.ts";

export function responseBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "");
}

export interface RpcBudget {
  /** Fraction of the 30 s host timeout a handler may use. Default 0.5 leaves room for slower machines. */
  timeFraction?: number;
  timeoutMs?: number;
  /** Largest JSON response. Default: a quarter of the relay frame. */
  maxBytes?: number;
}

export interface RpcMeasurement<T> {
  value: T;
  ms: number;
  bytes: number;
  limitMs: number;
  maxBytes: number;
  withinTime: boolean;
  withinBytes: boolean;
}

export async function measureRpc<T>(call: () => T | Promise<T>, budget: RpcBudget = {}): Promise<RpcMeasurement<T>> {
  const limitMs = (budget.timeoutMs ?? RPC_TIMEOUT_MS) * (budget.timeFraction ?? 0.5);
  const maxBytes = budget.maxBytes ?? RELAY_FRAME_BYTES / 4;
  const started = performance.now();
  const value = await call();
  const ms = performance.now() - started;
  const bytes = responseBytes(value);
  return { value, ms, bytes, limitMs, maxBytes, withinTime: ms <= limitMs, withinBytes: bytes <= maxBytes };
}

/** Throws with a readable message when a handler call exceeds its time or size budget. Returns the response. */
export async function assertWithinRpcBudget<T>(call: () => T | Promise<T>, budget: RpcBudget = {}): Promise<T> {
  const result = await measureRpc(call, budget);
  const problems: string[] = [];
  if (!result.withinTime) problems.push(`took ${Math.round(result.ms)} ms, budget ${Math.round(result.limitMs)} ms of the ${RPC_TIMEOUT_MS} ms host timeout`);
  if (!result.withinBytes) problems.push(`response is ${result.bytes} bytes, budget ${result.maxBytes}`);
  if (problems.length) throw new Error(`RPC over budget: ${problems.join("; ")}`);
  return result.value;
}
