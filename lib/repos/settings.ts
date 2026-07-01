import type { Database } from "bun:sqlite";
import type { Settings } from "../types";

export function getSettings(db: Database): Settings {
  const row = db
    .query("SELECT retries, step_timeout_seconds FROM settings WHERE id = 1")
    .get() as Settings;
  return row;
}

export function updateSettings(
  db: Database,
  patch: Partial<Settings>,
): Settings {
  const current = getSettings(db);
  const next: Settings = { ...current, ...patch };
  db.query(
    `UPDATE settings SET retries = $retries,
       step_timeout_seconds = $timeout WHERE id = 1`,
  ).run({ $retries: next.retries, $timeout: next.step_timeout_seconds });
  return next;
}
