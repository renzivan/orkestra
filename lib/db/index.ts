import { Database } from "bun:sqlite";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { join } from "path";
import { MIGRATIONS } from "./migrations";

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
  for (const stmt of MIGRATIONS) db.exec(stmt);
  return db;
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
