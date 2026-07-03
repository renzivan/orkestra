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
import { runTask, replyToRun } from "../../lib/engine/runner";
import { subscribeTasks } from "../../lib/engine/bus";

const ECHO = "bash test/fixtures/echo-model.sh";
// Emits a stable session_id + echoes stdin; "stream-json" in the command makes
// the runner parse it as Claude output (so session capture kicks in).
const SESSION = "bash test/fixtures/session-model.sh stream-json";

function agent(db: any, name: string, adapterId: number) {
  return Agents.createAgent(db, {
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
  const f = Flows.createFlow(db, { name: "pipe", agent_ids: [a1.id, a2.id] });
  const t = Tasks.createTask(db, {
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
  const t = Tasks.createTask(db, {
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
  const t = Tasks.createTask(db, {
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
  const t = Tasks.createTask(db, {
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

test("replying to a run without a session id throws", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, {
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
  Settings.updateSettings(db, { retries: 1, step_timeout_seconds: 5 });

  const failing = Adapters.createAdapter(db, {
    name: "fail",
    command: `bash -c 'echo x >> ${counter}; exit 1'`,
  });
  const okModel = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a1 = agent(db, "boom", failing.id);
  const a2 = agent(db, "never", okModel.id);
  const f = Flows.createFlow(db, { name: "pipe", agent_ids: [a1.id, a2.id] });
  const t = Tasks.createTask(db, {
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
