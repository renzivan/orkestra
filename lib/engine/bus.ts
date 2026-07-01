// In-memory pub/sub for live run output. Subscribers (the SSE endpoint) get
// events published by the runner as a run progresses.
//
// The listener registry is pinned on globalThis, NOT a plain module-level
// const. Next.js compiles Server Actions and Route Handlers into separate
// bundles with their own module instances, so a module-level Map would give
// the runner (invoked from a Server Action) a *different* Map than the SSE
// Route Handler subscribes to — the runner would publish into a bus with zero
// listeners and no live event would ever reach the browser. globalThis is the
// one registry shared across every bundle in the process.

import type { TranscriptEntry } from "./transcript";

export type RunEvent =
  | { type: "step"; position: number; agent_name: string; step_id: number; input: string }
  | { type: "transcript"; position: number; entries: TranscriptEntry[] }
  | { type: "step_done"; position: number; status: string; exit_code: number | null }
  | { type: "done"; status: string };

type Listener = (event: RunEvent) => void;

const g = globalThis as typeof globalThis & {
  __orkestraBus?: Map<number, Set<Listener>>;
};
const listeners: Map<number, Set<Listener>> = (g.__orkestraBus ??= new Map());

export function subscribe(runId: number, fn: Listener): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(runId);
  };
}

export function publish(runId: number, event: RunEvent): void {
  const set = listeners.get(runId);
  if (!set) return;
  for (const fn of set) fn(event);
}
