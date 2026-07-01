import type { Database } from "bun:sqlite";
import type { Agent, Task } from "../types";
import { getTask, setTaskStatus } from "../repos/tasks";
import { getFlow } from "../repos/flows";
import { getAgent } from "../repos/agents";
import { getAdapter } from "../repos/adapters";
import { getSettings } from "../repos/settings";
import * as Runs from "../repos/runs";
import { buildArgv } from "./template";
import { runStep } from "./exec";
import { publish } from "./bus";

/**
 * Run a task end to end: resolve its target to an ordered list of agents,
 * spawn each agent's model, chain output into the next input, retry a failed
 * step per Settings, persist every step, and stream progress over the bus.
 */
export async function runTask(
  db: Database,
  taskId: number,
): Promise<Runs.RunWithSteps> {
  const task = getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  const agents = resolveAgents(db, task);
  const settings = getSettings(db);
  const run = Runs.startRun(db, taskId);
  setTaskStatus(db, taskId, "running");

  let input = task.body;
  try {
    for (let pos = 0; pos < agents.length; pos++) {
      const agent = agents[pos];
      const adapter = getAdapter(db, agent.adapter_id);
      if (!adapter) throw new Error(`agent "${agent.name}" has no adapter`);

      const system = buildSystem(agent);
      const projects = agent.projects.map((p) => p.path);
      const effort = agent.effort === "off" ? "" : agent.effort;
      const argv = buildArgv(adapter.command, {
        system,
        input,
        projects,
        model: agent.model,
        effort,
      });

      const stepId = Runs.addRunStep(db, run.id, {
        position: pos,
        agent_id: agent.id,
        agent_name: agent.name,
        input,
      });
      publish(run.id, {
        type: "step",
        position: pos,
        agent_name: agent.name,
        step_id: stepId,
      });

      // Chunk events carry the full cumulative output (idempotent snapshot),
      // so replay + live delivery can't double-count. Output is also persisted
      // incrementally so a late subscriber / reload sees progress.
      let acc = "";
      const result = await attemptWithRetries(
        argv,
        input,
        settings.step_timeout_seconds * 1000,
        settings.retries,
        (delta) => {
          acc += delta;
          Runs.appendStepOutput(db, stepId, delta);
          publish(run.id, { type: "chunk", position: pos, text: acc });
        },
        () => {
          acc = "";
          Runs.clearStepOutput(db, stepId);
        },
      );

      if (result.exitCode === 0 && !result.timedOut) {
        Runs.finishRunStep(db, stepId, {
          output: result.stdout,
          exit_code: result.exitCode,
          error: null,
          status: "succeeded",
        });
        publish(run.id, {
          type: "step_done",
          position: pos,
          status: "succeeded",
          exit_code: result.exitCode,
        });
        input = result.stdout;
      } else {
        const reason = result.timedOut
          ? "timed out"
          : `exited ${result.exitCode}`;
        const detail = result.stderr.trim();
        Runs.finishRunStep(db, stepId, {
          output: result.stdout,
          exit_code: result.exitCode,
          error: detail ? `${reason}: ${detail}` : reason,
          status: "failed",
        });
        publish(run.id, {
          type: "step_done",
          position: pos,
          status: "failed",
          exit_code: result.exitCode,
        });
        return fail(
          db,
          run.id,
          taskId,
          `step ${pos} (${agent.name}) ${reason}`,
        );
      }
    }

    Runs.finishRun(db, run.id, {
      status: "succeeded",
      final_output: input,
      error: null,
    });
    setTaskStatus(db, taskId, "succeeded");
    publish(run.id, { type: "done", status: "succeeded" });
    return Runs.getRunWithSteps(db, run.id);
  } catch (e) {
    return fail(db, run.id, taskId, String(e));
  }
}

function fail(
  db: Database,
  runId: number,
  taskId: number,
  error: string,
): Runs.RunWithSteps {
  Runs.finishRun(db, runId, { status: "failed", final_output: null, error });
  setTaskStatus(db, taskId, "failed");
  publish(runId, { type: "done", status: "failed" });
  return Runs.getRunWithSteps(db, runId);
}

async function attemptWithRetries(
  argv: string[],
  input: string,
  timeoutMs: number,
  retries: number,
  onChunk: (text: string) => void,
  beforeAttempt: () => void,
) {
  beforeAttempt();
  let result = await runStep({ argv, input, timeoutMs, onChunk });
  let left = retries;
  while (left > 0 && (result.exitCode !== 0 || result.timedOut)) {
    left--;
    beforeAttempt();
    result = await runStep({ argv, input, timeoutMs, onChunk });
  }
  return result;
}

function resolveAgents(db: Database, task: Task): Agent[] {
  if (task.target_type === "flow") {
    const flow = getFlow(db, task.target_id);
    if (!flow) throw new Error(`flow ${task.target_id} not found`);
    return flow.agents;
  }
  const agent = getAgent(db, task.target_id);
  if (!agent) throw new Error(`agent ${task.target_id} not found`);
  return [agent];
}

function buildSystem(agent: Agent): string {
  return [agent.base_instruction, ...agent.skills.map((s) => s.body)]
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}
