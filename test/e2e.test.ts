import { expect, test, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

const DB_FILE = join(tmpdir(), `ork-e2e-${process.pid}.db`);

beforeEach(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    const f = DB_FILE + ext;
    if (existsSync(f)) rmSync(f);
  }
  process.env.ORKESTRA_DB = DB_FILE;
  const { resetDb } = await import("../lib/db");
  resetDb();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("end to end: build a flow via actions, run a task, chain succeeds", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Models = await import("../lib/repos/models");
  const Runs = await import("../lib/repos/runs");

  const m = Models.createModel(db(), {
    name: "echo",
    command: "bash test/fixtures/echo-model.sh",
  });
  const a1 = await A.saveAgent({
    name: "first",
    base_instruction: "one",
    model_id: m.id,
    skill_ids: [],
    project_ids: [],
  });
  const a2 = await A.saveAgent({
    name: "second",
    base_instruction: "two",
    model_id: m.id,
    skill_ids: [],
    project_ids: [],
  });
  const flow = await A.saveFlow({
    name: "pipe",
    agent_ids: [a1.id, a2.id],
  });
  const task = await A.createTaskAction({
    title: "demo",
    body: "seed-input",
    target_type: "flow",
    target_id: flow.id,
  });

  await A.runTaskAction(task.id);

  let run = null;
  for (let i = 0; i < 100; i++) {
    run = Runs.latestRunForTask(db(), task.id);
    if (run && run.status !== "running") break;
    await sleep(20);
  }
  expect(run?.status).toBe("succeeded");

  const full = Runs.getRunWithSteps(db(), run!.id);
  expect(full.steps.length).toBe(2);
  expect(full.steps[0].input).toBe("seed-input");
  expect(full.steps[1].input).toBe(full.steps[0].output);
});
