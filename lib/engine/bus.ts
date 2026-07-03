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
type TaskListener = () => void;

const g = globalThis as typeof globalThis & {
  __orkestraBus?: Map<number, Set<Listener>>;
  __orkestraTaskBus?: Set<TaskListener>;
};
const listeners: Map<number, Set<Listener>> = (g.__orkestraBus ??= new Map());
// A single process-wide topic for "some task changed status". The tasks board
// subscribes (via /api/tasks/stream) to re-render when a run starts or settles
// in the background — the board only has tasks, not run ids, so it can't use the
// per-run channel above. Pinned on globalThis for the same cross-bundle reason.
const taskListeners: Set<TaskListener> = (g.__orkestraTaskBus ??= new Set());

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
  // Isolate each subscriber: a listener that throws (e.g. an SSE stream whose
  // client already disconnected) must never propagate into the runner that
  // published the event, or it would break the run mid-flight.
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      /* a broken subscriber can't take down the publisher */
    }
  }
}

/** Subscribe to task-status changes (any task started or settled). */
export function subscribeTasks(fn: TaskListener): () => void {
  taskListeners.add(fn);
  return () => {
    taskListeners.delete(fn);
  };
}

/** Signal that a task changed status, so the board can re-render. */
export function publishTasksChanged(): void {
  // Same isolation as publish(): a throwing subscriber (e.g. a stale SSE stream
  // enqueuing into a closed controller) must not propagate into the runner's
  // setTaskStatus and break the run.
  for (const fn of taskListeners) {
    try {
      fn();
    } catch {
      /* a broken subscriber can't take down the publisher */
    }
  }
}
