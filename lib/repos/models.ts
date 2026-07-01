import type { Database } from "bun:sqlite";
import type { Model } from "../types";

export interface ModelInput {
  name: string;
  command: string;
}

export function createModel(db: Database, input: ModelInput): Model {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO models (name, command, created_at, updated_at)
       VALUES ($name, $command, $now, $now) RETURNING *`,
    )
    .get({ $name: input.name, $command: input.command, $now: now }) as Model;
}

export function listModels(db: Database): Model[] {
  return db
    .query("SELECT * FROM models ORDER BY name COLLATE NOCASE")
    .all() as Model[];
}

export function getModel(db: Database, id: number): Model | null {
  return (
    (db.query("SELECT * FROM models WHERE id = ?").get(id) as Model) ?? null
  );
}

export function updateModel(db: Database, id: number, input: ModelInput): Model {
  const now = new Date().toISOString();
  const row = db
    .query(
      `UPDATE models SET name = $name, command = $command, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({ $id: id, $name: input.name, $command: input.command, $now: now }) as
    | Model
    | null;
  if (!row) throw new Error(`model ${id} not found`);
  return row;
}

export function deleteModel(db: Database, id: number): void {
  db.query("DELETE FROM models WHERE id = ?").run(id);
}
