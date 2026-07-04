import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";

test("v11 lets tasks, runs and run_steps hold a 'paused' status", () => {
  const db = openDb(":memory:");
  // The CHECK constraints must accept 'paused' on all three tables.
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO tasks (title, body, target_type, target_id, status, space_id, created_at, updated_at)
     VALUES ('T', '', 'agent', 1, 'paused', 1, $n, $n)`,
  ).run({ $n: now });
  const task = db.query("SELECT id FROM tasks WHERE status='paused'").get() as {
    id: number;
  };
  expect(task).not.toBeNull();

  db.query(
    `INSERT INTO runs (task_id, status, started_at) VALUES ($t, 'paused', $n)`,
  ).run({ $t: task.id, $n: now });
  const run = db.query("SELECT id FROM runs WHERE status='paused'").get() as {
    id: number;
  };
  expect(run).not.toBeNull();

  db.query(
    `INSERT INTO run_steps (run_id, position, agent_id, agent_name, status, started_at)
     VALUES ($r, 0, 1, 'a', 'paused', $n)`,
  ).run({ $r: run.id, $n: now });
  const step = db
    .query("SELECT id FROM run_steps WHERE status='paused'")
    .get();
  expect(step).not.toBeNull();
});
