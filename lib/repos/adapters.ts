import type { Database } from "bun:sqlite";
import type { Adapter } from "../types";

export interface AdapterInput {
  name: string;
  command: string;
}

export function createAdapter(db: Database, input: AdapterInput): Adapter {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO adapters (name, command, created_at, updated_at)
       VALUES ($name, $command, $now, $now) RETURNING *`,
    )
    .get({ $name: input.name, $command: input.command, $now: now }) as Adapter;
}

export function listAdapters(db: Database): Adapter[] {
  return db
    .query("SELECT * FROM adapters ORDER BY name COLLATE NOCASE")
    .all() as Adapter[];
}

export function getAdapter(db: Database, id: number): Adapter | null {
  return (
    (db.query("SELECT * FROM adapters WHERE id = ?").get(id) as Adapter) ?? null
  );
}

export function updateAdapter(
  db: Database,
  id: number,
  input: AdapterInput,
): Adapter {
  const now = new Date().toISOString();
  const row = db
    .query(
      `UPDATE adapters SET name = $name, command = $command, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({ $id: id, $name: input.name, $command: input.command, $now: now }) as
    | Adapter
    | null;
  if (!row) throw new Error(`adapter ${id} not found`);
  return row;
}

/** Delete an adapter; agents using it get adapter_id = NULL and become
 *  non-runnable until reassigned (FK set-null). */
export function deleteAdapter(db: Database, id: number): void {
  db.query("DELETE FROM adapters WHERE id = ?").run(id);
}
