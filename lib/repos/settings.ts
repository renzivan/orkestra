import type { Database } from "bun:sqlite";
import type { Settings } from "../types";

/** A Space's run settings. Each Space has exactly one row (seeded by migration
 *  v11 for the initial Space and by createSpace afterwards). */
export function getSettings(db: Database, spaceId: number): Settings {
  const row = db
    .query(
      `SELECT retries, step_timeout_seconds, task_prefix
         FROM settings WHERE space_id = ?`,
    )
    .get(spaceId) as Settings;
  return row;
}

export function updateSettings(
  db: Database,
  spaceId: number,
  patch: Partial<Settings>,
): Settings {
  const current = getSettings(db, spaceId);
  const next: Settings = { ...current, ...patch };
  db.query(
    `UPDATE settings SET retries = $retries,
       step_timeout_seconds = $timeout,
       task_prefix = $prefix WHERE space_id = $space`,
  ).run({
    $retries: next.retries,
    $timeout: next.step_timeout_seconds,
    $prefix: next.task_prefix,
    $space: spaceId,
  });
  return next;
}
