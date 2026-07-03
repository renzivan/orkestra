import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Tasks from "../../lib/repos/tasks";
import { startRun } from "../../lib/repos/runs";

test("deleteTask removes the task and cascades its runs", () => {
  const db = openDb(":memory:");

  const task = Tasks.createTask(db, {
    title: "T",
    body: "b",
    target_type: "agent",
    target_id: 1,
  });
  const run = startRun(db, task.id);

  // sanity: the run exists and points at the task
  expect(
    (db.query("SELECT COUNT(*) AS n FROM runs WHERE task_id = ?").get(task.id) as { n: number }).n,
  ).toBe(1);

  Tasks.deleteTask(db, task.id);

  expect(Tasks.getTask(db, task.id)).toBeNull();
  expect(
    (db.query("SELECT COUNT(*) AS n FROM runs WHERE id = ?").get(run.id) as { n: number }).n,
  ).toBe(0);
});

function makeTask(db: ReturnType<typeof openDb>) {
  return Tasks.createTask(db, {
    title: "T",
    body: "b",
    target_type: "agent",
    target_id: 1,
  });
}

test("setTaskStatus stamps settled_at on terminal transitions only", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);

  // pending → running: not terminal, no settled_at yet.
  Tasks.setTaskStatus(db, task.id, "running");
  expect(Tasks.getTask(db, task.id)!.settled_at).toBeNull();

  // → succeeded: terminal, settled_at set.
  Tasks.setTaskStatus(db, task.id, "succeeded");
  expect(Tasks.getTask(db, task.id)!.settled_at).not.toBeNull();

  for (const s of ["failed", "stopped"] as const) {
    Tasks.setTaskStatus(db, makeTask(db).id, s);
  }
  expect(
    (db.query("SELECT COUNT(*) AS n FROM tasks WHERE settled_at IS NOT NULL").get() as { n: number }).n,
  ).toBe(3);
});

test("markTaskSeen sets seen_at without touching updated_at or settled_at", () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  Tasks.setTaskStatus(db, task.id, "succeeded");
  const before = Tasks.getTask(db, task.id)!;

  Tasks.markTaskSeen(db, task.id);
  const after = Tasks.getTask(db, task.id)!;

  expect(after.seen_at).not.toBeNull();
  expect(after.updated_at).toBe(before.updated_at);
  expect(after.settled_at).toBe(before.settled_at);
});

test("countUnreadTasks counts settled-and-unseen succeeded/failed only", () => {
  const db = openDb(":memory:");

  const succeeded = makeTask(db);
  Tasks.setTaskStatus(db, succeeded.id, "succeeded");
  const failed = makeTask(db);
  Tasks.setTaskStatus(db, failed.id, "failed");

  // Excluded statuses.
  Tasks.setTaskStatus(db, makeTask(db).id, "stopped");
  Tasks.setTaskStatus(db, makeTask(db).id, "running");
  makeTask(db); // pending

  expect(Tasks.countUnreadTasks(db)).toBe(2);

  // Opening one clears it.
  Tasks.markTaskSeen(db, succeeded.id);
  expect(Tasks.countUnreadTasks(db)).toBe(1);
});

test("isTaskUnread flags settled-and-unseen succeeded/failed only", () => {
  const db = openDb(":memory:");

  const succeeded = makeTask(db);
  Tasks.setTaskStatus(db, succeeded.id, "succeeded");
  expect(Tasks.isTaskUnread(Tasks.getTask(db, succeeded.id)!)).toBe(true);

  // Opening clears it.
  Tasks.markTaskSeen(db, succeeded.id);
  expect(Tasks.isTaskUnread(Tasks.getTask(db, succeeded.id)!)).toBe(false);

  // Excluded statuses are never unread.
  const stopped = makeTask(db);
  Tasks.setTaskStatus(db, stopped.id, "stopped");
  expect(Tasks.isTaskUnread(Tasks.getTask(db, stopped.id)!)).toBe(false);

  const pending = makeTask(db);
  expect(Tasks.isTaskUnread(Tasks.getTask(db, pending.id)!)).toBe(false);
});

test("countUnreadTasks re-arms after a fresh settle following a prior seen", async () => {
  const db = openDb(":memory:");
  const task = makeTask(db);
  Tasks.setTaskStatus(db, task.id, "succeeded");
  Tasks.markTaskSeen(db, task.id);
  expect(Tasks.countUnreadTasks(db)).toBe(0);

  // A re-run settles again after the prior seen; back to unread.
  await Bun.sleep(2); // ISO ms timestamps must strictly advance
  Tasks.setTaskStatus(db, task.id, "running");
  Tasks.setTaskStatus(db, task.id, "succeeded");
  expect(Tasks.countUnreadTasks(db)).toBe(1);
});

test("pausing a task does not stamp settled_at or count as unread", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: 1,
  });
  Tasks.setTaskStatus(db, t.id, "paused");
  const paused = Tasks.getTask(db, t.id)!;
  expect(paused.status).toBe("paused");
  expect(paused.settled_at).toBeNull(); // silent: no settle stamp
  expect(Tasks.isTaskUnread(paused)).toBe(false);
  expect(Tasks.countUnreadTasks(db)).toBe(0);
});
