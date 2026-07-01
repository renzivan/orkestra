import { expect, test, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

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
  const Models = await import("../lib/repos/models");
  const Runs = await import("../lib/repos/runs");

  const m = Models.createModel(db(), {
    name: "echo",
    command: "bash test/fixtures/echo-model.sh",
  });
  const agent = await A.saveAgent({
    name: "solo",
    base_instruction: "b",
    model_id: m.id,
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

test("deleting a referenced skill returns an error object", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Models = await import("../lib/repos/models");

  const m = Models.createModel(db(), { name: "echo", command: "c {input}" });
  const skill = await A.saveSkill({ name: "plan", body: "plan" });
  await A.saveAgent({
    name: "a",
    base_instruction: "b",
    model_id: m.id,
    skill_ids: [skill.id],
    project_ids: [],
  });

  const res = await A.deleteSkillAction(skill.id);
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/referenced/i);
});
