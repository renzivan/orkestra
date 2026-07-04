import { expect, test } from "bun:test";
import { entryFile } from "../support";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync, readFileSync } from "fs";
import { openDb } from "../../lib/db";
import * as Adapters from "../../lib/repos/adapters";
import * as Agents from "../../lib/repos/agents";
import * as Flows from "../../lib/repos/flows";
import * as Tasks from "../../lib/repos/tasks";
import * as Runs from "../../lib/repos/runs";
import * as Settings from "../../lib/repos/settings";
import { runTask, replyToRun, resumeRun } from "../../lib/engine/runner";
import { subscribeTasks } from "../../lib/engine/bus";

const SPACE = 1; // seeded "ETel" space (migration v12)

const ECHO = "bash test/fixtures/echo-model.sh";
// Emits a stable session_id + echoes stdin; "stream-json" in the command makes
// the runner parse it as Claude output (so session capture kicks in).
const SESSION = "bash test/fixtures/session-model.sh stream-json";
// Like SESSION, but tags its answer "resumed:" when invoked with --resume and
// "fresh:" otherwise — lets a test prove resume threads the session to the CLI.
const RESUME =
  "bash test/fixtures/resume-model.sh stream-json {resume:--resume}";

function agent(db: any, name: string, adapterId: number) {
  return Agents.createAgent(db, SPACE, {
    name,
    instructions: entryFile(name),
    adapter_id: adapterId,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
}

test("two-agent flow chains output into next input", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a1 = agent(db, "a1", m.id);
  const a2 = agent(db, "a2", m.id);
  const f = Flows.createFlow(db, SPACE, { name: "pipe", agent_ids: [a1.id, a2.id] });
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "seed",
    target_type: "flow",
    target_id: f.id,
  });

  const run = await runTask(db, t.id);

  expect(run.status).toBe("succeeded");
  expect(Tasks.getTask(db, t.id)!.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(2);
  expect(full.steps[0].input).toBe("seed");
  expect(full.steps[1].input).toBe(full.steps[0].output); // chaining
  expect(full.final_output).toBe(full.steps[1].output);
});

test("single-agent task runs one step", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  const run = await runTask(db, t.id);
  expect(run.status).toBe("succeeded");
  expect(Runs.getRunWithSteps(db, run.id).steps.length).toBe(1);
});

test("running a task pings the tasks topic on start and settle", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  let pings = 0;
  const unsub = subscribeTasks(() => pings++);
  try {
    await runTask(db, t.id);
  } finally {
    unsub();
  }

  // At least start (→running) and settle (→succeeded) both notify the board.
  expect(pings).toBeGreaterThanOrEqual(2);
});

test("captures session id and replies resume the run with a new step", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "sess", command: SESSION });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  const run = await runTask(db, t.id);
  expect(run.status).toBe("succeeded");
  let full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(1);
  expect(full.steps[0].output).toBe("echo:hi");
  expect(full.steps[0].session_id).toBe("sess-123"); // captured

  // Reply → appends a second step, resumes, run succeeds again.
  const replied = await replyToRun(db, run.id, "more");
  expect(replied.status).toBe("succeeded");
  full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(2);
  expect(full.steps[1].position).toBe(1);
  expect(full.steps[1].input).toBe("more");
  expect(full.steps[1].output).toBe("echo:more");
  expect(full.final_output).toBe("echo:more");
  expect(Tasks.getTask(db, t.id)!.status).toBe("succeeded");
});

// Seed a run whose single step was killed mid-flight (status 'paused'),
// optionally after capturing a CLI session id + partial transcript.
function seedPausedRun(
  db: any,
  taskId: number,
  a: { id: number; name: string },
  body: string,
  opts: { session?: string; transcript?: string } = {},
) {
  const run = Runs.startRun(db, taskId);
  const stepId = Runs.addRunStep(db, run.id, {
    position: 0,
    agent_id: a.id,
    agent_name: a.name,
    input: body,
  });
  if (opts.session) Runs.setStepSession(db, stepId, opts.session);
  if (opts.transcript) Runs.setStepTranscript(db, stepId, opts.transcript);
  Runs.finishRunStep(db, stepId, {
    output: "",
    exit_code: 143,
    error: null,
    status: "paused",
  });
  Runs.finishRun(db, run.id, {
    status: "paused",
    final_output: null,
    error: null,
  });
  return run;
}

test("resuming a stopped step keeps it and appends a --resume continuation", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "res", command: RESUME });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  // The interrupted step captured a session id (Claude adapters emit one before
  // the SIGTERM lands) and some partial transcript the user was watching.
  const partial = JSON.stringify([{ kind: "text", text: "partial work" }]);
  const run = seedPausedRun(db, t.id, a, t.body, {
    session: "sess-123",
    transcript: partial,
  });

  const resumed = await resumeRun(db, run.id);

  expect(resumed.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  // The paused step is preserved (its transcript stays on screen) and a
  // continuation is appended — not a wiped, single re-run.
  expect(full.steps.length).toBe(2);
  expect(full.steps[0].status).toBe("paused");
  expect(full.steps[0].transcript).toContain("partial work");
  expect(full.steps[1].position).toBe(1);
  expect(full.steps[1].input).toBe("hi"); // re-sends the original input
  // "resumed:" (not "fresh:") proves --resume reached the CLI on the continuation.
  expect(full.steps[1].output).toBe("resumed:hi");
  expect(full.final_output).toBe("resumed:hi");
  expect(Tasks.getTask(db, t.id)!.status).toBe("succeeded");
});

test("resuming a stopped step with no session falls back to a fresh continuation", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "res", command: RESUME });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  // No session captured — a non-Claude adapter, or a kill before one emitted.
  const run = seedPausedRun(db, t.id, a, t.body);

  const resumed = await resumeRun(db, run.id);

  expect(resumed.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(2);
  expect(full.steps[0].status).toBe("paused"); // still preserved
  expect(full.steps[1].output).toBe("fresh:hi"); // no --resume flag passed
});

test("resuming a flow stopped between steps continues the remaining agents", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a1 = agent(db, "a1", m.id);
  const a2 = agent(db, "a2", m.id);
  const f = Flows.createFlow(db, SPACE, { name: "pipe", agent_ids: [a1.id, a2.id] });
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "seed",
    target_type: "flow",
    target_id: f.id,
  });

  // First agent finished, then the run was stopped before the second started:
  // every existing step 'succeeded', so resume just runs the remaining agent.
  const run = Runs.startRun(db, t.id);
  const s0 = Runs.addRunStep(db, run.id, {
    position: 0,
    agent_id: a1.id,
    agent_name: a1.name,
    input: "seed",
  });
  Runs.finishRunStep(db, s0, {
    output: "echo:seed",
    exit_code: 0,
    error: null,
    status: "succeeded",
  });
  Runs.finishRun(db, run.id, {
    status: "stopped",
    final_output: null,
    error: null,
  });

  const resumed = await resumeRun(db, run.id);

  expect(resumed.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(2); // a1 kept, a2 appended
  expect(full.steps[0].output).toBe("echo:seed"); // untouched
  expect(full.steps[1].agent_name).toBe("a2");
  expect(full.steps[1].input).toBe("echo:seed"); // chained from a1's output
  expect(full.final_output).toBe(full.steps[1].output);
});

test("replying to a run without a session id throws", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });
  const run = await runTask(db, t.id);
  expect(run.steps[run.steps.length - 1].session_id).toBeNull();
  await expect(replyToRun(db, run.id, "x")).rejects.toThrow(/not resumable/i);
});

test("failing step retries then fails, stopping the flow", async () => {
  const db = openDb(":memory:");
  const counter = join(tmpdir(), `ork-retry-${process.pid}-${Date.now()}`);
  if (existsSync(counter)) rmSync(counter);
  Settings.updateSettings(db, SPACE, { retries: 1, step_timeout_seconds: 5 });

  const failing = Adapters.createAdapter(db, {
    name: "fail",
    command: `bash -c 'echo x >> ${counter}; exit 1'`,
  });
  const okModel = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a1 = agent(db, "boom", failing.id);
  const a2 = agent(db, "never", okModel.id);
  const f = Flows.createFlow(db, SPACE, { name: "pipe", agent_ids: [a1.id, a2.id] });
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "x",
    target_type: "flow",
    target_id: f.id,
  });

  const run = await runTask(db, t.id);

  expect(run.status).toBe("failed");
  expect(Tasks.getTask(db, t.id)!.status).toBe("failed");
  // ran attempt + 1 retry = 2 invocations
  const attempts = readFileSync(counter, "utf8").trim().split("\n").length;
  expect(attempts).toBe(2);
  // second agent never ran
  expect(Runs.getRunWithSteps(db, run.id).steps.length).toBe(1);
  rmSync(counter);
});

test("a run uses its own Space's settings, not another Space's", async () => {
  const Spaces = await import("../../lib/repos/spaces");
  const db = openDb(":memory:");
  const counter = join(tmpdir(), `ork-space-retry-${process.pid}-${Date.now()}`);
  if (existsSync(counter)) rmSync(counter);

  // Seed Space keeps retries = 1; a second Space is set to retries = 0.
  const work = Spaces.createSpace(db, { name: "Work" });
  Settings.updateSettings(db, SPACE, { retries: 1, step_timeout_seconds: 5 });
  Settings.updateSettings(db, work.id, { retries: 0, step_timeout_seconds: 5 });

  const failing = Adapters.createAdapter(db, {
    name: "fail",
    command: `bash -c 'echo x >> ${counter}; exit 1'`,
  });
  // Agent + task live in the Work Space; the runner must resolve retries from it.
  const a = Agents.createAgent(db, work.id, {
    name: "boom",
    instructions: [{ name: "AGENTS.md", body: "boom", is_entry: true }],
    adapter_id: failing.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const t = Tasks.createTask(db, work.id, {
    title: "T",
    body: "x",
    target_type: "agent",
    target_id: a.id,
  });

  const run = await runTask(db, t.id);

  expect(run.status).toBe("failed");
  // retries = 0 → a single attempt, no retry (proving Work's settings won, not
  // the seed Space's retries = 1).
  const attempts = readFileSync(counter, "utf8").trim().split("\n").length;
  expect(attempts).toBe(1);
  rmSync(counter);
});
