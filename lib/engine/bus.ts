// In-memory pub/sub for live run output. Subscribers (the SSE endpoint) get
// events published by the runner as a run progresses. Process-local only.

export type RunEvent =
  | { type: "step"; position: number; agent_name: string; step_id: number }
  | { type: "chunk"; position: number; text: string }
  | { type: "step_done"; position: number; status: string; exit_code: number | null }
  | { type: "done"; status: string };

type Listener = (event: RunEvent) => void;

const listeners = new Map<number, Set<Listener>>();

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
