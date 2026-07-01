import type { Database } from "bun:sqlite";
import type { Task, TargetType, TaskStatus } from "../types";

export interface TaskInput {
  title: string;
  body: string;
  target_type: TargetType;
  target_id: number;
}

export function createTask(db: Database, input: TaskInput): Task {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO tasks (title, body, target_type, target_id, status, created_at, updated_at)
       VALUES ($title, $body, $tt, $tid, 'pending', $now, $now) RETURNING *`,
    )
    .get({
      $title: input.title,
      $body: input.body,
      $tt: input.target_type,
      $tid: input.target_id,
      $now: now,
    }) as Task;
}

export function setTaskStatus(
  db: Database,
  id: number,
  status: TaskStatus,
): void {
  const now = new Date().toISOString();
  db.query(
    "UPDATE tasks SET status = $status, updated_at = $now WHERE id = $id",
  ).run({ $id: id, $status: status, $now: now });
}

export function listTasks(db: Database): Task[] {
  return db.query("SELECT * FROM tasks ORDER BY created_at DESC").all() as Task[];
}

export function getTask(db: Database, id: number): Task | null {
  return (db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task) ?? null;
}
