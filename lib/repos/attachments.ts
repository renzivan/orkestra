import type { Database } from "bun:sqlite";
import type { Attachment } from "../types";

export interface AttachmentInput {
  task_id: number;
  /** NULL for a task-body attachment; the reply step for a reply attachment. */
  run_step_id: number | null;
  space_id: number;
  filename: string;
  disk_path: string;
  mime: string | null;
  size: number;
}

export function createAttachment(
  db: Database,
  input: AttachmentInput,
): Attachment {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO attachments
         (task_id, run_step_id, space_id, filename, disk_path, mime, size, created_at)
       VALUES ($task, $step, $space, $name, $path, $mime, $size, $now)
       RETURNING *`,
    )
    .get({
      $task: input.task_id,
      $step: input.run_step_id,
      $space: input.space_id,
      $name: input.filename,
      $path: input.disk_path,
      $mime: input.mime,
      $size: input.size,
      $now: now,
    }) as Attachment;
}

/** A task's body attachments (run_step_id IS NULL) — the ones the first step of a
 *  run injects. Ordered by creation so chips render in upload order. */
export function listTaskBodyAttachments(
  db: Database,
  taskId: number,
): Attachment[] {
  return db
    .query(
      `SELECT * FROM attachments
        WHERE task_id = ? AND run_step_id IS NULL
        ORDER BY id`,
    )
    .all(taskId) as Attachment[];
}

/** The attachments sent with one reply step. */
export function listStepAttachments(
  db: Database,
  runStepId: number,
): Attachment[] {
  return db
    .query("SELECT * FROM attachments WHERE run_step_id = ? ORDER BY id")
    .all(runStepId) as Attachment[];
}

export function getAttachment(db: Database, id: number): Attachment | null {
  return (
    (db.query("SELECT * FROM attachments WHERE id = ?").get(id) as Attachment) ??
    null
  );
}

/** Delete one attachment row. The on-disk file is removed by the caller (the
 *  action layer owns the filesystem); this touches only the row. */
export function deleteAttachment(db: Database, id: number): void {
  db.query("DELETE FROM attachments WHERE id = ?").run(id);
}
