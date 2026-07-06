import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Tasks from "../../lib/repos/tasks";
import * as Attachments from "../../lib/repos/attachments";
import { startRun, addRunStep } from "../../lib/repos/runs";

const SPACE = 1; // seeded "ETel" space

function makeTask(db: ReturnType<typeof openDb>) {
  return Tasks.createTask(db, SPACE, {
    title: "T",
    body: "b",
    target_type: "agent",
    target_id: 1,
  });
}

function draft(taskId: number, name: string, stepId: number | null = null) {
  return {
    task_id: taskId,
    run_step_id: stepId,
    space_id: SPACE,
    filename: name,
    disk_path: `/tmp/orkestra/attachments/${taskId}/${name}`,
    mime: null,
    size: 10,
  };
}

test("createAttachment round-trips and returns the row", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  const a = Attachments.createAttachment(db, draft(task.id, "shot.png"));
  expect(a.id).toBeGreaterThan(0);
  expect(a.filename).toBe("shot.png");
  expect(a.run_step_id).toBeNull();
  expect(Attachments.getAttachment(db, a.id)?.disk_path).toBe(a.disk_path);
});

test("listTaskBodyAttachments returns only run_step_id IS NULL rows", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  const run = startRun(db, task.id);
  const step = addRunStep(db, run.id, {
    position: 1,
    agent_id: 1,
    agent_name: "A",
    input: "reply",
  });

  Attachments.createAttachment(db, draft(task.id, "body-one.png"));
  Attachments.createAttachment(db, draft(task.id, "body-two.log"));
  Attachments.createAttachment(db, draft(task.id, "reply.png", step));

  const body = Attachments.listTaskBodyAttachments(db, task.id);
  expect(body.map((a) => a.filename)).toEqual(["body-one.png", "body-two.log"]);

  const forStep = Attachments.listStepAttachments(db, step);
  expect(forStep.map((a) => a.filename)).toEqual(["reply.png"]);
});

test("deleteAttachment removes the row", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  const a = Attachments.createAttachment(db, draft(task.id, "x.txt"));
  Attachments.deleteAttachment(db, a.id);
  expect(Attachments.getAttachment(db, a.id)).toBeNull();
});

test("deleting a task cascades its attachment rows", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  Attachments.createAttachment(db, draft(task.id, "a.png"));
  Attachments.createAttachment(db, draft(task.id, "b.png"));

  Tasks.deleteTask(db, task.id);

  expect(
    (
      db
        .query("SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?")
        .get(task.id) as { n: number }
    ).n,
  ).toBe(0);
});

test("deleting a run cascades its reply attachment rows", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  const run = startRun(db, task.id);
  const step = addRunStep(db, run.id, {
    position: 1,
    agent_id: 1,
    agent_name: "A",
    input: "reply",
  });
  Attachments.createAttachment(db, draft(task.id, "reply.png", step));

  db.query("DELETE FROM runs WHERE id = ?").run(run.id);

  expect(Attachments.listStepAttachments(db, step)).toEqual([]);
});
