import type { Database } from "bun:sqlite";
import type { Agent, Project, Skill } from "../types";
import { assertNotReferenced } from "../refs";

export interface AgentInput {
  name: string;
  base_instruction: string;
  adapter_id: number;
  model: string;
  effort: string;
  /** Skip headless permission prompts (default true — see migration v5). */
  skip_permissions?: boolean;
  skill_ids: number[];
  project_ids: number[];
}

interface AgentRow {
  id: number;
  name: string;
  base_instruction: string;
  adapter_id: number;
  model: string;
  effort: string;
  skip_permissions: number; // SQLite 0/1
  created_at: string;
  updated_at: string;
}

export function createAgent(db: Database, input: AgentInput): Agent {
  const now = new Date().toISOString();
  const insert = db.transaction((i: AgentInput) => {
    const row = db
      .query(
        `INSERT INTO agents (name, base_instruction, adapter_id, model, effort, skip_permissions, created_at, updated_at)
         VALUES ($name, $base, $adapter, $model, $effort, $skip, $now, $now) RETURNING id`,
      )
      .get({
        $name: i.name,
        $base: i.base_instruction,
        $adapter: i.adapter_id,
        $model: i.model,
        $effort: i.effort,
        $skip: (i.skip_permissions ?? true) ? 1 : 0,
        $now: now,
      }) as { id: number };
    writeRelations(db, row.id, i);
    return row.id;
  });
  const id = insert(input);
  return getAgent(db, id)!;
}

export function updateAgent(
  db: Database,
  id: number,
  input: AgentInput,
): Agent {
  const now = new Date().toISOString();
  const tx = db.transaction((i: AgentInput) => {
    const res = db
      .query(
        `UPDATE agents SET name = $name, base_instruction = $base,
           adapter_id = $adapter, model = $model, effort = $effort,
           skip_permissions = $skip, updated_at = $now WHERE id = $id`,
      )
      .run({
        $id: id,
        $name: i.name,
        $base: i.base_instruction,
        $adapter: i.adapter_id,
        $model: i.model,
        $effort: i.effort,
        $skip: (i.skip_permissions ?? true) ? 1 : 0,
        $now: now,
      });
    if (res.changes === 0) throw new Error(`agent ${id} not found`);
    db.query("DELETE FROM agent_skills WHERE agent_id = ?").run(id);
    db.query("DELETE FROM agent_projects WHERE agent_id = ?").run(id);
    writeRelations(db, id, i);
  });
  tx(input);
  return getAgent(db, id)!;
}

function writeRelations(db: Database, agentId: number, input: AgentInput): void {
  const skillStmt = db.query(
    `INSERT INTO agent_skills (agent_id, skill_id, position)
     VALUES ($a, $s, $pos)`,
  );
  input.skill_ids.forEach((skillId, pos) => {
    skillStmt.run({ $a: agentId, $s: skillId, $pos: pos });
  });
  const projStmt = db.query(
    `INSERT INTO agent_projects (agent_id, project_id) VALUES ($a, $p)`,
  );
  for (const projectId of input.project_ids) {
    projStmt.run({ $a: agentId, $p: projectId });
  }
}

export function listAgents(db: Database): Agent[] {
  const rows = db
    .query("SELECT id FROM agents ORDER BY name COLLATE NOCASE")
    .all() as { id: number }[];
  return rows.map((r) => getAgent(db, r.id)!);
}

export function getAgent(db: Database, id: number): Agent | null {
  const row =
    (db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow) ?? null;
  if (!row) return null;

  const skills = db
    .query(
      `SELECT s.* FROM skills s
       JOIN agent_skills a ON a.skill_id = s.id
       WHERE a.agent_id = ? ORDER BY a.position`,
    )
    .all(id) as Skill[];

  const projects = db
    .query(
      `SELECT p.* FROM projects p
       JOIN agent_projects a ON a.project_id = p.id
       WHERE a.agent_id = ? ORDER BY p.name COLLATE NOCASE`,
    )
    .all(id) as Project[];

  return { ...row, skip_permissions: row.skip_permissions === 1, skills, projects };
}

export function deleteAgent(db: Database, id: number): void {
  assertNotReferenced(db, "agent", id);
  db.query("DELETE FROM agents WHERE id = ?").run(id);
}
