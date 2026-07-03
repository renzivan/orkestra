import type { Database } from "bun:sqlite";
import type { Agent, Task } from "../types";
import { getTask, setTaskStatus as repoSetTaskStatus } from "../repos/tasks";
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
import { publish, publishTasksChanged } from "./bus";
import {
  register,
  unregister,
  setProc,
  clearProc,
  isAborted,
} from "./registry";

// Every task status change in the runner (start, settle) also pings the tasks
// topic, so a board sitting open re-renders live instead of waiting for a manual
// refresh. Wrapping the repo call keeps all call sites notifying with no repeats.
function setTaskStatus(db: Database, id: number, status: Task["status"]): void {
  repoSetTaskStatus(db, id, status);
  publishTasksChanged();
}

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

  return runFrom(db, run.id, task, agents, settings, 0, task.body);
}

/**
 * Resume a stopped run: re-run from its first non-succeeded step, keeping the
 * completed earlier steps and chaining the previous step's output (or the task
 * body, if the very first step) as input. The interrupted step is deleted and
 * re-created fresh, so the run keeps a single coherent timeline.
 */
export async function resumeRun(
  db: Database,
  runId: number,
): Promise<Runs.RunWithSteps> {
  const run = Runs.getRunWithSteps(db, runId);
  const task = getTask(db, run.task_id);
  if (!task) throw new Error(`task ${run.task_id} not found`);
  const agents = resolveAgents(db, task);
  const settings = getSettings(db);

  const stoppedAt = run.steps.findIndex((s) => s.status !== "succeeded");
  const startPos = stoppedAt === -1 ? run.steps.length : stoppedAt;
  const input = startPos === 0 ? task.body : run.steps[startPos - 1].output;

  Runs.reopenRun(db, runId);
  setTaskStatus(db, task.id, "running");
  Runs.deleteStepsFrom(db, runId, startPos);

  return runFrom(db, runId, task, agents, settings, startPos, input);
}

/**
 * Shared step loop for both a fresh run and a resume. Registers the run so it
 * can be stopped, executes agents from `startPos` chaining output→input, and
 * lands the run in a terminal state (succeeded / failed / stopped).
 */
async function runFrom(
  db: Database,
  runId: number,
  task: Task,
  agents: Agent[],
  settings: { step_timeout_seconds: number; retries: number },
  startPos: number,
  seedInput: string,
): Promise<Runs.RunWithSteps> {
  register(runId);
  let input = seedInput;
  try {
    for (let pos = startPos; pos < agents.length; pos++) {
      if (isAborted(runId)) return stopRun(db, runId, task.id);

      const agent = agents[pos];
      const adapter =
        agent.adapter_id == null ? null : getAdapter(db, agent.adapter_id);
      if (!adapter) throw new Error(`agent "${agent.name}" has no adapter`);

      const step = await executeStep(db, runId, pos, agent, adapter, settings, {
        input,
      });
      if (step.stopped) return stopRun(db, runId, task.id);
      if (!step.ok) {
        return fail(db, runId, task.id, `step ${pos} (${agent.name}) ${step.reason}`);
      }
      input = step.output;
    }

    Runs.finishRun(db, runId, {
      status: "succeeded",
      final_output: input,
      error: null,
    });
    setTaskStatus(db, task.id, "succeeded");
    publish(runId, { type: "done", status: "succeeded" });
    return Runs.getRunWithSteps(db, runId);
  } catch (e) {
    return fail(db, runId, task.id, String(e));
  } finally {
    unregister(runId);
  }
}

/**
 * Continue a finished run: the agent asked something and the user replied. Reopen
 * the run, resume the last step's CLI session (--resume) with the reply as a new
 * step, and stream it live like any other step.
 */
export async function replyToRun(
  db: Database,
  runId: number,
  reply: string,
): Promise<Runs.RunWithSteps> {
  const run = Runs.getRunWithSteps(db, runId);
  const last = run.steps[run.steps.length - 1];
  if (!last?.session_id) throw new Error(`run ${runId} is not resumable`);
  const agent = getAgent(db, last.agent_id);
  if (!agent) throw new Error(`agent ${last.agent_id} not found`);
  const adapter =
    agent.adapter_id == null ? null : getAdapter(db, agent.adapter_id);
  if (!adapter) throw new Error(`agent "${agent.name}" has no adapter`);
  const settings = getSettings(db);

  Runs.reopenRun(db, runId);
  setTaskStatus(db, run.task_id, "running");

  register(runId);
  try {
    const step = await executeStep(
      db,
      runId,
      last.position + 1,
      agent,
      adapter,
      settings,
      { input: reply, resume: last.session_id },
    );
    if (step.stopped) return stopRun(db, runId, run.task_id);
    if (!step.ok) {
      return fail(db, runId, run.task_id, `reply (${agent.name}) ${step.reason}`);
    }
    Runs.finishRun(db, runId, {
      status: "succeeded",
      final_output: step.output,
      error: null,
    });
    setTaskStatus(db, run.task_id, "succeeded");
    publish(runId, { type: "done", status: "succeeded" });
    return Runs.getRunWithSteps(db, runId);
  } catch (e) {
    return fail(db, runId, run.task_id, String(e));
  } finally {
    unregister(runId);
  }
}

type StepOutcome =
  | { ok: true; output: string; stopped?: false }
  | { ok: false; reason: string; stopped?: false }
  | { ok: false; stopped: true };

/**
 * Run one agent invocation as a persisted, live-streamed step. The transcript
 * is a full snapshot (idempotent) persisted + published on every change, so a
 * live subscriber and a mid-run reload both catch up without double-counting.
 * runStep's return is the clean answer text — this step's output.
 */
async function executeStep(
  db: Database,
  runId: number,
  pos: number,
  agent: Agent,
  adapter: { command: string },
  settings: { step_timeout_seconds: number; retries: number },
  opts: { input: string; resume?: string },
): Promise<StepOutcome> {
  const makeTransform = transformFor(adapter.command);
  const argv = buildArgv(adapter.command, {
    system: buildSystem(agent),
    input: opts.input,
    projects: agent.projects.map((p) => p.path),
    model: agent.model,
    effort: agent.effort === "off" ? "" : agent.effort,
    resume: opts.resume ?? "",
    skip: agent.skip_permissions,
  });

  const stepId = Runs.addRunStep(db, runId, {
    position: pos,
    agent_id: agent.id,
    agent_name: agent.name,
    input: opts.input,
  });
  publish(runId, {
    type: "step",
    position: pos,
    agent_name: agent.name,
    step_id: stepId,
    input: opts.input,
  });

  const { result, sessionId } = await attemptWithRetries(
    argv,
    opts.input,
    settings.step_timeout_seconds * 1000,
    settings.retries,
    makeTransform,
    (entries) => {
      Runs.setStepTranscript(db, stepId, JSON.stringify(entries));
      publish(runId, { type: "transcript", position: pos, entries });
    },
    () => Runs.clearStepTranscript(db, stepId),
    (proc) => setProc(runId, proc),
    () => isAborted(runId),
  );
  clearProc(runId);
  if (sessionId) Runs.setStepSession(db, stepId, sessionId);

  // A user stop killed the process — record the step as stopped (not failed)
  // and let the caller wind the run down. The abort flag, not the exit code, is
  // the source of truth: a killed CLI exits non-zero but that isn't a failure.
  if (isAborted(runId)) {
    Runs.finishRunStep(db, stepId, {
      output: result.stdout,
      exit_code: result.exitCode,
      error: null,
      status: "stopped",
    });
    publish(runId, {
      type: "step_done",
      position: pos,
      status: "stopped",
      exit_code: result.exitCode,
    });
    return { ok: false, stopped: true };
  }

  if (result.exitCode === 0 && !result.timedOut) {
    Runs.finishRunStep(db, stepId, {
      output: result.stdout,
      exit_code: result.exitCode,
      error: null,
      status: "succeeded",
    });
    publish(runId, {
      type: "step_done",
      position: pos,
      status: "succeeded",
      exit_code: result.exitCode,
    });
    return { ok: true, output: result.stdout };
  }

  const reason = result.timedOut ? "timed out" : `exited ${result.exitCode}`;
  const detail = result.stderr.trim();
  Runs.finishRunStep(db, stepId, {
    output: result.stdout,
    exit_code: result.exitCode,
    error: detail ? `${reason}: ${detail}` : reason,
    status: "failed",
  });
  publish(runId, {
    type: "step_done",
    position: pos,
    status: "failed",
    exit_code: result.exitCode,
  });
  return { ok: false, reason };
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

/** Wind a run down after a user stop: mark the run and task stopped. The
 *  interrupted step was already marked stopped by executeStep (if one was
 *  mid-flight); a stop between steps simply leaves earlier steps intact. */
function stopRun(
  db: Database,
  runId: number,
  taskId: number,
): Runs.RunWithSteps {
  Runs.finishRun(db, runId, {
    status: "stopped",
    final_output: null,
    error: null,
  });
  setTaskStatus(db, taskId, "stopped");
  publish(runId, { type: "done", status: "stopped" });
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
  onSpawn: (proc: Bun.Subprocess) => void,
  aborted: () => boolean,
) {
  // A fresh, stateful transform per attempt whose onChange reports the live
  // transcript. Declared with `let` so the onChange closure can read it back.
  let sessionId = "";
  const attempt = async () => {
    let transform: StreamTransform;
    transform = makeTransform(() => onTranscript(transform.entries()));
    const r = await runStep({ argv, input, timeoutMs, transform, onSpawn });
    sessionId = transform.sessionId() || sessionId;
    return r;
  };
  beforeAttempt();
  let result = await attempt();
  let left = retries;
  // Don't retry a step the user stopped — the non-zero exit is the kill, not a
  // failure worth re-attempting.
  while (left > 0 && !aborted() && (result.exitCode !== 0 || result.timedOut)) {
    left--;
    beforeAttempt();
    result = await attempt();
  }
  return { result, sessionId };
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
