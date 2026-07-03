import { expect, test } from "bun:test";
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
import { runTask, resumeRun } from "../../lib/engine/runner";
import { stop } from "../../lib/engine/registry";

const ECHO = "bash test/fixtures/echo-model.sh";

function agent(db: any, name: string, adapterId: number) {
  return Agents.createAgent(db, {
    name,
    base_instruction: name,
    adapter_id: adapterId,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
}

/** Poll `fn` until it returns truthy or the timeout elapses. */
async function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

test("stopping a running task marks it stopped and does not retry", async () => {
  const db = openDb(":memory:");
  const counter = join(tmpdir(), `ork-stop-${process.pid}-${Date.now()}`);
  if (existsSync(counter)) rmSync(counter);
  Settings.updateSettings(db, { retries: 2, step_timeout_seconds: 60 });

  const sleepy = Adapters.createAdapter(db, {
    name: "sleep",
    command: `bash test/fixtures/sleep-model.sh ${counter}`,
  });
  const a = agent(db, "blocker", sleepy.id);
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  const p = runTask(db, t.id); // do not await — it blocks in the sleeping step
  const run = Runs.latestRunForTask(db, t.id)!;
  expect(run).not.toBeNull();
  // Wait until the step has actually spawned (counter file written).
  await waitFor(() => existsSync(counter));

  stop(run.id);
  const finished = await p;

  expect(finished.status).toBe("stopped");
  expect(Tasks.getTask(db, t.id)!.status).toBe("stopped");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(1);
  expect(full.steps[0].status).toBe("stopped");
  // The killed step is not retried despite retries=2.
  const invocations = readFileSync(counter, "utf8").trim().split("\n").length;
  expect(invocations).toBe(1);
  rmSync(counter);
});

test("resume keeps the interrupted step and appends its continuation", async () => {
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
  const step0Output = Runs.getRunWithSteps(db, run.id).steps[0].output;

  // Simulate a stop at the second step: step 0 stayed succeeded, step 1 stopped.
  const now = new Date().toISOString();
  db.query("UPDATE runs SET status='stopped', finished_at=$n WHERE id=$id").run({
    $id: run.id,
    $n: now,
  });
  db.query(
    "UPDATE run_steps SET status='stopped' WHERE run_id=$r AND position=1",
  ).run({ $r: run.id });
  Tasks.setTaskStatus(db, t.id, "stopped");

  const resumed = await resumeRun(db, run.id);

  expect(resumed.status).toBe("succeeded");
  expect(Tasks.getTask(db, t.id)!.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  // step 0 (succeeded) + step 1 (stopped, preserved) + continuation appended.
  expect(full.steps.length).toBe(3);
  expect(full.steps[0].status).toBe("succeeded");
  expect(full.steps[1].status).toBe("stopped"); // interrupted step kept on screen
  expect(full.steps[2].status).toBe("succeeded"); // continuation of a2
  expect(full.steps[2].agent_name).toBe("a2");
  // The continuation re-sends the interrupted step's own input (step 0's output).
  expect(full.steps[2].input).toBe(step0Output);
  expect(full.final_output).toBe(full.steps[2].output);
});

test("resume of a single-agent task keeps step 0 and continues from the task body", async () => {
  const db = openDb(":memory:");
  const m = Adapters.createAdapter(db, { name: "echo", command: ECHO });
  const a = agent(db, "solo", m.id);
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hello",
    target_type: "agent",
    target_id: a.id,
  });

  const run = await runTask(db, t.id);
  const now = new Date().toISOString();
  db.query("UPDATE runs SET status='stopped', finished_at=$n WHERE id=$id").run({
    $id: run.id,
    $n: now,
  });
  db.query(
    "UPDATE run_steps SET status='stopped' WHERE run_id=$r AND position=0",
  ).run({ $r: run.id });
  Tasks.setTaskStatus(db, t.id, "stopped");

  const resumed = await resumeRun(db, run.id);
  expect(resumed.status).toBe("succeeded");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps.length).toBe(2); // stopped step kept, continuation appended
  expect(full.steps[0].status).toBe("stopped");
  expect(full.steps[1].input).toBe("hello"); // continued from task.body
});
