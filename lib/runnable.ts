import type { Database } from "bun:sqlite";
import type { Task } from "./types";
import { getAgent } from "./repos/agents";
import { getFlow } from "./repos/flows";

export interface Runnable {
  ok: boolean;
  /** Human-readable reason the task can't run (only set when ok is false). */
  reason?: string;
}

/**
 * Can this task run right now? A task points at an agent or a flow; deleting
 * those (or an agent's adapter) leaves the task pointing at something that can't
 * execute. Recomputed from live data every time — reassigning an adapter or
 * editing a flow makes a task runnable again with no stored state to update.
 */
export function taskRunnable(db: Database, task: Task): Runnable {
  if (task.target_type === "agent") {
    const agent = getAgent(db, task.target_id);
    if (!agent) return { ok: false, reason: "agent was deleted" };
    if (agent.adapter_id == null) {
      return { ok: false, reason: "agent has no adapter" };
    }
    return { ok: true };
  }

  const flow = getFlow(db, task.target_id);
  if (!flow) return { ok: false, reason: "flow was deleted" };
  if (flow.agents.length === 0) return { ok: false, reason: "flow has no steps" };
  const noAdapter = flow.agents.find((a) => a.adapter_id == null);
  if (noAdapter) {
    return { ok: false, reason: `step agent "${noAdapter.name}" has no adapter` };
  }
  return { ok: true };
}
