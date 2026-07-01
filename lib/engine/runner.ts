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
import {
  passthrough,
  claudeStream,
  type StreamTransform,
  type TranscriptEntry,
} from "./transcript";
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

      const makeTransform = transformFor(adapter.command);
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

      // The transcript is a full snapshot (idempotent) persisted + published on
      // every change, so a live subscriber and a mid-run reload both catch up
      // without double-counting. runStep's return value is the clean answer
      // text (the transcript's `text` entries), used as this step's output.
      const result = await attemptWithRetries(
        argv,
        input,
        settings.step_timeout_seconds * 1000,
        settings.retries,
        makeTransform,
        (entries) => {
          Runs.setStepTranscript(db, stepId, JSON.stringify(entries));
          publish(run.id, { type: "transcript", position: pos, entries });
        },
        () => Runs.clearStepTranscript(db, stepId),
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
  makeTransform: (onChange: () => void) => StreamTransform,
  onTranscript: (entries: TranscriptEntry[]) => void,
  beforeAttempt: () => void,
) {
  // A fresh, stateful transform per attempt whose onChange reports the live
  // transcript. Declared with `let` so the onChange closure can read it back.
  const attempt = () => {
    let transform: StreamTransform;
    transform = makeTransform(() => onTranscript(transform.entries()));
    return runStep({ argv, input, timeoutMs, transform });
  };
  beforeAttempt();
  let result = await attempt();
  let left = retries;
  while (left > 0 && (result.exitCode !== 0 || result.timedOut)) {
    left--;
    beforeAttempt();
    result = await attempt();
  }
  return result;
}

/** Choose how to decode a CLI's stdout: parse stream-json, else passthrough. */
function transformFor(
  command: string,
): (onChange: () => void) => StreamTransform {
  return command.includes("stream-json") ? claudeStream : passthrough;
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
