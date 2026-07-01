import { Database } from "bun:sqlite";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { join } from "path";
import { MIGRATIONS } from "./migrations";
import { reconcileStaleRuns } from "../repos/runs";

/**
 * Open a SQLite database and run all migrations.
 * - No path given: uses ORKESTRA_DB env var, else ~/.orkestra/orkestra.db.
 * - Pass ":memory:" or a temp path in tests.
 */
export function openDb(path?: string): Database {
  const file = path ?? defaultDbPath();
  const db = new Database(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  // A previous process may have died mid-run — clear any stuck 'running' rows.
  reconcileStaleRuns(db);
  return db;
}

function runMigrations(db: Database): void {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;
  if (current >= MIGRATIONS.length) return;
  for (let v = current; v < MIGRATIONS.length; v++) {
    for (const stmt of MIGRATIONS[v]) db.exec(stmt);
  }
  // PRAGMA doesn't accept bound params; version is an internal integer.
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
}

function defaultDbPath(): string {
  const fromEnv = process.env.ORKESTRA_DB;
  if (fromEnv) return fromEnv;
  const dir = join(homedir(), ".orkestra");
  mkdirSync(dir, { recursive: true });
  return join(dir, "orkestra.db");
}

let _db: Database | null = null;

/** Shared process-wide connection for the app (lazy). */
export function db(): Database {
  return (_db ??= openDb());
}

/** Test hook: drop the cached connection so the next db() re-opens. */
export function resetDb(): void {
  _db?.close();
  _db = null;
}
