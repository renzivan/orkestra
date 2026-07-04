import type { Database } from "bun:sqlite";
import type { Skill } from "../types";

export interface SkillInput {
  name: string;
  body: string;
}

export function createSkill(
  db: Database,
  spaceId: number,
  input: SkillInput,
): Skill {
  const now = new Date().toISOString();
  const row = db
    .query(
      `INSERT INTO skills (name, body, space_id, created_at, updated_at)
       VALUES ($name, $body, $space, $now, $now) RETURNING *`,
    )
    .get({
      $name: input.name,
      $body: input.body,
      $space: spaceId,
      $now: now,
    }) as Skill;
  return row;
}

export function listSkills(db: Database, spaceId: number): Skill[] {
  return db
    .query("SELECT * FROM skills WHERE space_id = ? ORDER BY name COLLATE NOCASE")
    .all(spaceId) as Skill[];
}

export function getSkill(db: Database, id: number): Skill | null {
  return (db.query("SELECT * FROM skills WHERE id = ?").get(id) as Skill) ?? null;
}

export function updateSkill(db: Database, id: number, input: SkillInput): Skill {
  const now = new Date().toISOString();
  const row = db
    .query(
      `UPDATE skills SET name = $name, body = $body, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({ $id: id, $name: input.name, $body: input.body, $now: now }) as
    | Skill
    | null;
  if (!row) throw new Error(`skill ${id} not found`);
  return row;
}

/** Delete a skill; it is dropped from any agent that used it (FK cascade). */
export function deleteSkill(db: Database, id: number): void {
  db.query("DELETE FROM skills WHERE id = ?").run(id);
}
