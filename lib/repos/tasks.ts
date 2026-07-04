import type { Database } from "bun:sqlite";
import type { Task, TargetType, TaskStatus } from "../types";

export interface TaskInput {
  title: string;
  body: string;
  target_type: TargetType;
  target_id: number;
}

/** Display label for a task: "<prefix>-<id>: <title>", or just the title when
 *  no prefix is set. */
export function taskLabel(prefix: string, id: number, title: string): string {
  return prefix ? `${prefix}-${id}: ${title}` : title;
}

/** Confirmation message for deleting a task; warns when a live run will be
 *  stopped. Label is the task's display label (see taskLabel). */
export function taskDeleteMessage(label: string, running: boolean): string {
  return running
    ? `Delete "${label}"?\n\nThis task is running and will be stopped.\n\nThis can't be undone.`
    : `Delete "${label}"? This can't be undone.`;
}

export function createTask(
  db: Database,
  spaceId: number,
  input: TaskInput,
): Task {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO tasks (title, body, target_type, target_id, status, space_id, created_at, updated_at)
       VALUES ($title, $body, $tt, $tid, 'pending', $space, $now, $now) RETURNING *`,
    )
    .get({
      $title: input.title,
      $body: input.body,
      $tt: input.target_type,
      $tid: input.target_id,
      $space: spaceId,
      $now: now,
    }) as Task;
}

// Statuses that count as a task having "settled" — the run ended a turn and it's
// the user's move (or it broke, or they stopped it). Entering one stamps
// settled_at, which drives the unread badge.
const TERMINAL: TaskStatus[] = ["succeeded", "failed", "stopped"];

export function setTaskStatus(
  db: Database,
  id: number,
  status: TaskStatus,
): void {
  const now = new Date().toISOString();
  // Terminal transitions also stamp settled_at (re-arming the unread badge);
  // non-terminal ones leave it, so a re-run's brief 'running' doesn't clear it.
  const settle = TERMINAL.includes(status) ? ", settled_at = $now" : "";
  db.query(
    `UPDATE tasks SET status = $status, updated_at = $now${settle} WHERE id = $id`,
  ).run({ $id: id, $status: status, $now: now });
}

/** Mark a task's detail as seen by the user, clearing it from the unread badge.
 *  Deliberately leaves updated_at and settled_at untouched. */
export function markTaskSeen(db: Database, id: number): void {
  const now = new Date().toISOString();
  db.query("UPDATE tasks SET seen_at = $now WHERE id = $id").run({
    $id: id,
    $now: now,
  });
}

/** Does this task need the user's attention — settled into succeeded/failed and
 *  not opened since it last settled? Pure (no DB); mirrors countUnreadTasks so
 *  the board can flag the exact cards that make up the sidebar badge. */
export function isTaskUnread(t: Task): boolean {
  if (t.status !== "succeeded" && t.status !== "failed") return false;
  if (!t.settled_at) return false;
  return t.seen_at === null || t.seen_at < t.settled_at;
}

/** Count tasks needing the user's attention in a Space: settled into
 *  succeeded/failed and not opened since (seen_at null or older than
 *  settled_at). Powers the sidebar Tasks badge, which is scoped to the active
 *  Space. */
export function countUnreadTasks(db: Database, spaceId: number): number {
  return (
    db
      .query(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE space_id = $space
            AND status IN ('succeeded','failed')
            AND settled_at IS NOT NULL
            AND (seen_at IS NULL OR seen_at < settled_at)`,
      )
      .get({ $space: spaceId }) as { n: number }
  ).n;
}

export function listTasks(db: Database, spaceId: number): Task[] {
  return db
    .query("SELECT * FROM tasks WHERE space_id = ? ORDER BY created_at DESC")
    .all(spaceId) as Task[];
}

export function getTask(db: Database, id: number): Task | null {
  return (db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task) ?? null;
}

/** Delete a task; its runs and run_steps are removed by FK cascade. */
export function deleteTask(db: Database, id: number): void {
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
}
