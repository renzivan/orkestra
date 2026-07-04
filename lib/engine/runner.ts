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
  abortIntent,
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
  const settings = getSettings(db, task.space_id);
  const run = Runs.startRun(db, taskId);
  setTaskStatus(db, taskId, "running");

  return runFrom(db, run.id, task, agents, settings, 0, 0, task.body);
}

/**
 * Resume a stopped run. Two shapes:
 *
 * - Stopped *between* steps (every step succeeded, the flow just never reached
 *   the next agent): continue with the remaining agents, chaining the last
 *   output as input.
 * - Stopped *mid-step* (the last step is non-succeeded): the interrupted step is
 *   KEPT — its partial transcript stays on screen — and a continuation step is
 *   appended after it that resumes the agent's captured CLI session (--resume,
 *   re-sending the step's original input) so the agent picks up its prior context
 *   instead of cold-starting. The remaining flow agents then run as usual. No
 *   session (a non-Claude adapter, or a kill before one was emitted) falls back
 *   to a fresh attempt of that agent.
 */
export async function resumeRun(
  db: Database,
  runId: number,
): Promise<Runs.RunWithSteps> {
  const run = Runs.getRunWithSteps(db, runId);
  const task = getTask(db, run.task_id);
  if (!task) throw new Error(`task ${run.task_id} not found`);
  const agents = resolveAgents(db, task);
  const settings = getSettings(db, task.space_id);

  const stoppedAt = run.steps.findIndex((s) => s.status !== "succeeded");

  Runs.reopenRun(db, runId);
  setTaskStatus(db, task.id, "running");

  if (stoppedAt === -1) {
    // Every step finished; resume the flow at the next agent. Positions still
    // map 1:1 to agents here, so agent index and step position are the same.
    const nextAgent = run.steps.length;
    const seedInput =
      nextAgent === 0 ? task.body : run.steps[nextAgent - 1].output;
    return runFrom(db, runId, task, agents, settings, nextAgent, nextAgent, seedInput);
  }

  // Mid-step: preserve the interrupted step and append a continuation. The
  // continuation re-runs the same agent (index `stoppedAt`) as a new step at the
  // end (position run.steps.length), resuming its session and re-sending its
  // original input; the loop then carries on into any later flow agents.
  const interrupted = run.steps[stoppedAt];
  const resume = interrupted.session_id ?? undefined;
  return runFrom(
    db,
    runId,
    task,
    agents,
    settings,
    stoppedAt,
    run.steps.length,
    interrupted.input,
    resume,
  );
}

/**
 * Shared step loop for both a fresh run and a resume. Registers the run so it
 * can be stopped, executes agents from `startAgent` chaining output→input, and
 * lands the run in a terminal state (succeeded / failed / stopped).
 *
 * Agent index and step position are tracked separately: a resume appends a
 * continuation step *after* the interrupted step it preserves, so the position
 * of a step can run ahead of its agent's index in the flow.
 */
async function runFrom(
  db: Database,
  runId: number,
  task: Task,
  agents: Agent[],
  settings: { step_timeout_seconds: number; retries: number },
  startAgent: number,
  startPos: number,
  seedInput: string,
  // Only set by a resume: the CLI session the interrupted step captured. Applies
  // to the first re-run agent (startAgent) alone — later agents are genuinely
  // new conversations, so they never inherit a session.
  resumeSession?: string,
): Promise<Runs.RunWithSteps> {
  register(runId);
  let input = seedInput;
  try {
    let pos = startPos;
    for (let ai = startAgent; ai < agents.length; ai++, pos++) {
      if (isAborted(runId)) return stopRun(db, runId, task.id);

      const agent = agents[ai];
      const adapter =
        agent.adapter_id == null ? null : getAdapter(db, agent.adapter_id);
      if (!adapter) throw new Error(`agent "${agent.name}" has no adapter`);

      const step = await executeStep(db, runId, pos, agent, adapter, settings, {
        input,
        resume: ai === startAgent ? resumeSession : undefined,
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
  const task = getTask(db, run.task_id);
  if (!task) throw new Error(`task ${run.task_id} not found`);
  const settings = getSettings(db, task.space_id);

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

  // A user halt killed the process — record the step as paused or stopped (not
  // failed) per the halt intent, and let the caller wind the run down. The abort
  // flag, not the exit code, is the source of truth: a killed CLI exits non-zero
  // but that isn't a failure.
  if (isAborted(runId)) {
    const status = abortIntent(runId) === "pause" ? "paused" : "stopped";
    Runs.finishRunStep(db, stepId, {
      output: result.stdout,
      exit_code: result.exitCode,
      error: null,
      status,
    });
    publish(runId, {
      type: "step_done",
      position: pos,
      status,
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

/** Wind a run down after a user halt: mark the run and task paused or stopped to
 *  match the halt intent. The interrupted step (if one was mid-flight) was
 *  already marked to match by executeStep; a halt between steps leaves earlier
 *  steps intact. */
function stopRun(
  db: Database,
  runId: number,
  taskId: number,
): Runs.RunWithSteps {
  const status = abortIntent(runId) === "pause" ? "paused" : "stopped";
  Runs.finishRun(db, runId, { status, final_output: null, error: null });
  setTaskStatus(db, taskId, status);
  publish(runId, { type: "done", status });
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

// Compose an agent's system prompt: its instruction files first (ENTRY leading,
// then the rest in stored order), each headed by its filename so the model can
// tell the pieces apart, followed by skill bodies as raw text. Empty-bodied
// files drop out — an empty ENTRY (e.g. the freshly seeded Default agent)
// contributes nothing, exactly as an empty base_instruction did before.
export function buildSystem(agent: Agent): string {
  const files = [...agent.instructions].sort(
    (a, b) => Number(b.is_entry) - Number(a.is_entry) || a.position - b.position,
  );
  const blocks = files
    .filter((f) => f.body.trim().length > 0)
    .map((f) => `# ${f.name}\n${f.body}`);
  return [...blocks, ...agent.skills.map((s) => s.body)]
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}
