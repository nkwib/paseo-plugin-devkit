// The fake agent's turn script. Pure and import-free so the devkit tests and docs can share it.

export type FakeStep =
  | { say: string }
  | { think: string }
  | { write: { path: string; content: string } }
  | { edit: { path: string; old: string; new: string } }
  | { bash: { command: string; run?: boolean; output?: string; exitCode?: number } }
  | { mcp: { server: string; tool: string; arguments?: Record<string, unknown> } }
  | { sleep: number }
  | { fail: string };

export interface FakeScript {
  steps: FakeStep[];
  /** Pause before every step, in ms (default 0). */
  stepDelayMs?: number;
}

/** A file in the agent's cwd that scripts turns whose prompt is not a script: turn N runs turns[N-1], else the last. */
export const TURNS_FILE = ".fake-agent.json";
const FENCE = /```fake-agent\s*\n([\s\S]*?)```/;
const STEP_KEYS = ["say", "think", "write", "edit", "bash", "mcp", "sleep", "fail"] as const;

export function parseScript(value: unknown): FakeScript {
  const raw = Array.isArray(value) ? { steps: value } : value;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { steps?: unknown }).steps)) {
    throw new Error("a fake-agent script is an object with a steps array (or a bare array of steps)");
  }
  const { steps, stepDelayMs } = raw as { steps: unknown[]; stepDelayMs?: unknown };
  steps.forEach((step, index) => {
    const keys = step && typeof step === "object" ? Object.keys(step) : [];
    if (keys.length !== 1 || !(STEP_KEYS as readonly string[]).includes(keys[0]!)) {
      throw new Error(`step ${index}: expected exactly one of ${STEP_KEYS.join(", ")}, got ${JSON.stringify(step)}`);
    }
  });
  if (stepDelayMs !== undefined && (typeof stepDelayMs !== "number" || stepDelayMs < 0)) throw new Error("stepDelayMs must be a number >= 0");
  return { steps: steps as FakeStep[], ...(stepDelayMs !== undefined ? { stepDelayMs } : {}) };
}

/** The script a prompt carries: the whole prompt as JSON, or a ```fake-agent fenced block. Null for plain prompts. */
export function scriptFromPrompt(prompt: string): FakeScript | null {
  const text = prompt.trim();
  const fenced = FENCE.exec(text)?.[1];
  const candidate = fenced ?? (text.startsWith("{") || text.startsWith("[") ? text : null);
  if (candidate === null) return null;
  return parseScript(JSON.parse(candidate));
}

/** Turn N (1-based) from a turns file: `{ "turns": [script, ...] }`. */
export function scriptFromTurnsFile(contents: string, turn: number): FakeScript | null {
  const turns = (JSON.parse(contents) as { turns?: unknown }).turns;
  if (!Array.isArray(turns) || turns.length === 0) throw new Error(`${TURNS_FILE} needs a non-empty "turns" array`);
  return parseScript(turns[Math.min(turn, turns.length) - 1]);
}

/** What a plain prompt gets: one assistant message echoing it. */
export function defaultScript(prompt: string): FakeScript {
  return { steps: [{ say: `fake-agent received: ${prompt.trim() || "(empty prompt)"}` }] };
}
