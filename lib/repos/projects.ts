import type { Database } from "bun:sqlite";
import type { Project } from "../types";

export interface ProjectInput {
  name: string;
  path: string;
}

export function createProject(db: Database, input: ProjectInput): Project {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO projects (name, path, created_at, updated_at)
       VALUES ($name, $path, $now, $now) RETURNING *`,
    )
    .get({ $name: input.name, $path: input.path, $now: now }) as Project;
}

export function listProjects(db: Database): Project[] {
  return db
    .query("SELECT * FROM projects ORDER BY name COLLATE NOCASE")
    .all() as Project[];
}

export function getProject(db: Database, id: number): Project | null {
  return (
    (db.query("SELECT * FROM projects WHERE id = ?").get(id) as Project) ?? null
  );
}

export function updateProject(
  db: Database,
  id: number,
  input: ProjectInput,
): Project {
  const now = new Date().toISOString();
  const row = db
    .query(
      `UPDATE projects SET name = $name, path = $path, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({ $id: id, $name: input.name, $path: input.path, $now: now }) as
    | Project
    | null;
  if (!row) throw new Error(`project ${id} not found`);
  return row;
}

export function deleteProject(db: Database, id: number): void {
  db.query("DELETE FROM projects WHERE id = ?").run(id);
}
