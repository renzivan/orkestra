import { expect, test, beforeEach } from "bun:test";
import { entryFile } from "./support";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

const SPACE = 1; // seeded "ETel" space (migration v12)

const DB_FILE = join(tmpdir(), `ork-actions-${process.pid}.db`);

beforeEach(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    const f = DB_FILE + ext;
    if (existsSync(f)) rmSync(f);
  }
  process.env.ORKESTRA_DB = DB_FILE;
  const { resetDb } = await import("../lib/db");
  resetDb();
});

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

test("create + run a single-agent task reaches succeeded", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Adapters = await import("../lib/repos/adapters");
  const Runs = await import("../lib/repos/runs");

  const ad = Adapters.createAdapter(db(), {
    name: "echo",
    command: "bash test/fixtures/echo-model.sh",
  });
  const agent = await A.saveAgent({
    name: "solo",
    instructions: entryFile("b"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const task = await A.createTaskAction({
    title: "T",
    body: "hello",
    target_type: "agent",
    target_id: agent.id,
  });

  await A.runTaskAction(task.id);

  let run = null;
  for (let i = 0; i < 50; i++) {
    run = Runs.latestRunForTask(db(), task.id);
    if (run && run.status !== "running") break;
    await sleep(20);
  }
  expect(run?.status).toBe("succeeded");
});

test("deleting a referenced skill succeeds and drops it from the agent", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Adapters = await import("../lib/repos/adapters");
  const Agents = await import("../lib/repos/agents");

  const ad = Adapters.createAdapter(db(), { name: "echo", command: "c {input}" });
  const skill = await A.saveSkill({ name: "plan", body: "plan" });
  const agent = await A.saveAgent({
    name: "a",
    instructions: entryFile("b"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [skill.id],
    project_ids: [],
  });

  const res = await A.deleteSkillAction(skill.id);
  expect(res.ok).toBe(true);
  expect(Agents.getAgent(db(), agent.id)!.skills.length).toBe(0);
});

test("deleting a target agent reassigns its task to the Default agent", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Adapters = await import("../lib/repos/adapters");
  const Agents = await import("../lib/repos/agents");
  const Tasks = await import("../lib/repos/tasks");

  const ad = Adapters.createAdapter(db(), { name: "echo", command: "c {input}" });
  const agent = await A.saveAgent({
    name: "a",
    instructions: entryFile("b"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: agent.id,
  });
  Agents.deleteAgent(db(), agent.id);

  // The task now points at the Default agent instead of a deleted one.
  const def = Agents.getDefaultAgent(db(), SPACE);
  const got = Tasks.getTask(db(), task.id)!;
  expect(got.target_id).toBe(def.id);

  // The seeded Default agent has no adapter yet, so the run is still refused —
  // but for "no adapter", not "deleted".
  const res = await A.runTaskAction(task.id);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toMatch(/adapter/);
});

test("deleteTaskAction removes the task and its runs", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");

  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  Runs.startRun(db(), task.id);

  const res = await A.deleteTaskAction(task.id);
  expect(res.ok).toBe(true);
  expect(Tasks.getTask(db(), task.id)).toBeNull();
  expect(Runs.latestRunForTask(db(), task.id)).toBeNull();
});

test("deleteTaskAction stops the live run of a running task", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");
  const Registry = await import("../lib/engine/registry");

  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db(), task.id);
  Tasks.setTaskStatus(db(), task.id, "running");
  Registry.register(run.id); // simulate a live run tracked by the engine

  const res = await A.deleteTaskAction(task.id);
  expect(res.ok).toBe(true);
  // stop() flagged the run aborted before the row cascaded away
  expect(Registry.isAborted(run.id)).toBe(true);
});

test("deleting a non-running task does not call stop()", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");
  const Registry = await import("../lib/engine/registry");

  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db(), task.id);
  Registry.register(run.id); // simulate a live run tracked by the engine

  const res = await A.deleteTaskAction(task.id);
  expect(res.ok).toBe(true);
  // task.status stayed 'pending', so stop() was never called for this run
  expect(Registry.isAborted(run.id)).toBe(false);
});
