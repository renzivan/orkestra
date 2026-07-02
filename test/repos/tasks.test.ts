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
