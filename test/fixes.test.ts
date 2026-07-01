import { expect, test, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

const DB_FILE = join(tmpdir(), `ork-fixes-${process.pid}.db`);

beforeEach(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    const f = DB_FILE + ext;
    if (existsSync(f)) rmSync(f);
  }
  process.env.ORKESTRA_DB = DB_FILE;
  const { resetDb } = await import("../lib/db");
  resetDb();
});

test("reopening the DB marks stale 'running' runs/steps/tasks as failed", async () => {
  const { db, resetDb, openDb } = await import("../lib/db");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");

  const t = Tasks.createTask(db(), {
    title: "T",
    body: "x",
    target_type: "agent",
    target_id: 1,
  });
  Tasks.setTaskStatus(db(), t.id, "running");
  const run = Runs.startRun(db(), t.id);
  Runs.addRunStep(db(), run.id, {
    position: 0,
    agent_id: 1,
    agent_name: "a",
    input: "x",
  });

  // Simulate a crash: drop the connection and reopen the same file.
  resetDb();
  const reopened = openDb(DB_FILE);

  expect(Runs.latestRunForTask(reopened, t.id)!.status).toBe("failed");
  expect(Tasks.getTask(reopened, t.id)!.status).toBe("failed");
  expect(Runs.getRunWithSteps(reopened, run.id).steps[0].status).toBe("failed");
});

test("saving a duplicate name returns a friendly error", async () => {
  const A = await import("../app/actions");
  await A.saveSkill({ name: "plan", body: "plan" });
  await expect(
    A.saveSkill({ name: "PLAN", body: "x" }),
  ).rejects.toThrow(/already exists/i);
});

test("SSE subscribes before replay so live events aren't lost", async () => {
  const { db } = await import("../lib/db");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");
  const { publish } = await import("../lib/engine/bus");
  const { GET } = await import("../app/api/runs/[id]/stream/route");

  const t = Tasks.createTask(db(), {
    title: "T",
    body: "x",
    target_type: "agent",
    target_id: 1,
  });
  Tasks.setTaskStatus(db(), t.id, "running");
  const run = Runs.startRun(db(), t.id); // status 'running' → stream stays open

  const res = await GET(new Request("http://x/"), {
    params: Promise.resolve({ id: String(run.id) }),
  });

  // Route has subscribed synchronously; publish live events now.
  publish(run.id, { type: "step", position: 0, agent_name: "a", step_id: 1 });
  publish(run.id, { type: "chunk", position: 0, text: "hello" });
  publish(run.id, {
    type: "step_done",
    position: 0,
    status: "succeeded",
    exit_code: 0,
  });
  publish(run.id, { type: "done", status: "succeeded" });

  const events: any[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.replace(/^data: /, "").trim();
      if (line) events.push(JSON.parse(line));
    }
  }

  expect(events.find((e) => e.type === "chunk")?.text).toBe("hello");
  expect(events.find((e) => e.type === "done")?.status).toBe("succeeded");
});
