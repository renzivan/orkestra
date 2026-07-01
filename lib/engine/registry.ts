// Tracks in-flight runs so a user can stop one mid-flight. Maps runId to the
// live child process (if any) plus an `aborted` flag the runner polls between
// and after steps.
//
// Like the bus, the map is pinned on globalThis — Next.js compiles Server
// Actions (which start/stop runs) and Route Handlers into separate bundles with
// their own module instances, so a plain module-level Map would let the stop
// action and the runner see different registries and never meet.

import type { Subprocess } from "bun";

interface RunHandle {
  proc: Subprocess | null;
  aborted: boolean;
}

const g = globalThis as typeof globalThis & {
  __orkestraRuns?: Map<number, RunHandle>;
};
const runs: Map<number, RunHandle> = (g.__orkestraRuns ??= new Map());

/** Begin tracking a run. Resets state, so resuming can reuse the same run id. */
export function register(runId: number): void {
  runs.set(runId, { proc: null, aborted: false });
}

/** Record the process currently executing a step so stop() can kill it. */
export function setProc(runId: number, proc: Subprocess): void {
  const h = runs.get(runId);
  if (h) h.proc = proc;
}

/** Detach the current process handle once its step has finished. */
export function clearProc(runId: number): void {
  const h = runs.get(runId);
  if (h) h.proc = null;
}

/** Request a stop: flag the run aborted and kill its live process, if any. */
export function stop(runId: number): void {
  const h = runs.get(runId);
  if (!h) return;
  h.aborted = true;
  h.proc?.kill(); // SIGTERM — lets the CLI exit; runner treats it as stopped
}

/** Whether a stop has been requested for this run. */
export function isAborted(runId: number): boolean {
  return runs.get(runId)?.aborted ?? false;
}

/** Stop tracking a run once it reaches a terminal state. */
export function unregister(runId: number): void {
  runs.delete(runId);
}
