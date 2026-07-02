import type { Database } from "bun:sqlite";
import type { Agent, Project, Skill } from "../types";

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
  adapter_id: number | null;
  model: string;
  effort: string;
  skip_permissions: number; // SQLite 0/1
  is_default: number; // SQLite 0/1
  created_at: string;
  updated_at: string;
}

export function createAgent(db: Database, input: AgentInput): Agent {
  const now = new Date().toISOString();
  const insert = db.transaction((i: AgentInput) => {
    const row = db
      .query(
        `INSERT INTO agents (name, base_instruction, adapter_id, model, effort, skip_permissions, is_default, created_at, updated_at)
         VALUES ($name, $base, $adapter, $model, $effort, $skip, 0, $now, $now) RETURNING id`,
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
  // The Default agent's name is locked and its projects are always "all", so
  // ignore any name/project_ids a (possibly stale) caller sends for it.
  const isDefault = isDefaultAgent(db, id);
  const tx = db.transaction((i: AgentInput) => {
    const res = db
      .query(
        `UPDATE agents SET name = $name, base_instruction = $base,
           adapter_id = $adapter, model = $model, effort = $effort,
           skip_permissions = $skip, updated_at = $now WHERE id = $id`,
      )
      .run({
        $id: id,
        $name: isDefault ? "Default" : i.name,
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
    writeRelations(db, id, isDefault ? { ...i, project_ids: [] } : i);
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

  // The Default agent is scoped to every project, resolved live so projects
  // added after it was seeded are included automatically (its agent_projects
  // rows are never written). Others use their explicit project list.
  const projects =
    row.is_default === 1
      ? (db
          .query("SELECT * FROM projects ORDER BY name COLLATE NOCASE")
          .all() as Project[])
      : (db
          .query(
            `SELECT p.* FROM projects p
             JOIN agent_projects a ON a.project_id = p.id
             WHERE a.agent_id = ? ORDER BY p.name COLLATE NOCASE`,
          )
          .all(id) as Project[]);

  return {
    ...row,
    skip_permissions: row.skip_permissions === 1,
    is_default: row.is_default === 1,
    skills,
    projects,
  };
}

/** The built-in Default agent (always present — seeded by migration v9). */
export function getDefaultAgent(db: Database): Agent {
  const row = db
    .query("SELECT id FROM agents WHERE is_default = 1")
    .get() as { id: number } | null;
  if (!row) throw new Error("default agent missing");
  return getAgent(db, row.id)!;
}

function isDefaultAgent(db: Database, id: number): boolean {
  const row = db
    .query("SELECT is_default FROM agents WHERE id = ?")
    .get(id) as { is_default: number } | null;
  return row?.is_default === 1;
}

/** Delete an agent. The built-in Default agent can't be deleted. Otherwise, in
 *  one transaction: tasks that targeted this agent are reassigned to the Default
 *  agent (so they stay runnable), then the agent is removed (its flow steps drop
 *  via FK cascade). */
export function deleteAgent(db: Database, id: number): void {
  if (isDefaultAgent(db, id)) {
    throw new Error("The default agent can't be deleted.");
  }
  const now = new Date().toISOString();
  const defaultId = getDefaultAgent(db).id;
  const tx = db.transaction(() => {
    db.query(
      `UPDATE tasks SET target_id = $default, updated_at = $now
       WHERE target_type = 'agent' AND target_id = $id`,
    ).run({ $default: defaultId, $now: now, $id: id });
    db.query("DELETE FROM agents WHERE id = ?").run(id);
  });
  tx();
}
