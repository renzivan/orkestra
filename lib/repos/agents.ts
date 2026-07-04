import type { Database } from "bun:sqlite";
import type { Agent, AgentInstruction, Project, Skill } from "../types";

/** One instruction file as supplied by a caller; position is the array index,
 *  and exactly one element must have is_entry set. */
export interface InstructionInput {
  name: string;
  body: string;
  is_entry: boolean;
}

export interface AgentInput {
  name: string;
  /** Ordered instruction files. Must hold at least one file and exactly one
   *  entry; array order becomes each file's stored position. */
  instructions: InstructionInput[];
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
  adapter_id: number | null;
  model: string;
  effort: string;
  skip_permissions: number; // SQLite 0/1
  is_default: number; // SQLite 0/1
  space_id: number;
  created_at: string;
  updated_at: string;
}

/** Reject instruction sets the schema would accept as rows but that violate the
 *  domain rules (at least one file, exactly one entry, unique non-empty names).
 *  Thrown before any write so a bad set never partially lands. */
function validateInstructions(instructions: InstructionInput[]): void {
  if (instructions.length === 0) {
    throw new Error("An agent needs at least one instruction file.");
  }
  const entries = instructions.filter((i) => i.is_entry).length;
  if (entries !== 1) {
    throw new Error("Exactly one instruction file must be the entry file.");
  }
  const seen = new Set<string>();
  for (const i of instructions) {
    const name = i.name.trim();
    if (name.length === 0) {
      throw new Error("Every instruction file needs a name.");
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate instruction file name: ${name}`);
    }
    seen.add(name);
  }
}

export function createAgent(
  db: Database,
  spaceId: number,
  input: AgentInput,
): Agent {
  validateInstructions(input.instructions);
  const now = new Date().toISOString();
  const insert = db.transaction((i: AgentInput) => {
    const row = db
      .query(
        `INSERT INTO agents (name, adapter_id, model, effort, skip_permissions, is_default, space_id, created_at, updated_at)
         VALUES ($name, $adapter, $model, $effort, $skip, 0, $space, $now, $now) RETURNING id`,
      )
      .get({
        $name: i.name,
        $adapter: i.adapter_id,
        $model: i.model,
        $effort: i.effort,
        $skip: (i.skip_permissions ?? true) ? 1 : 0,
        $space: spaceId,
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
  validateInstructions(input.instructions);
  const now = new Date().toISOString();
  // The Default agent's name is locked and its projects are always "all", so
  // ignore any name/project_ids a (possibly stale) caller sends for it. Its
  // instructions are still editable like any other agent's.
  const isDefault = isDefaultAgent(db, id);
  const tx = db.transaction((i: AgentInput) => {
    const res = db
      .query(
        `UPDATE agents SET name = $name,
           adapter_id = $adapter, model = $model, effort = $effort,
           skip_permissions = $skip, updated_at = $now WHERE id = $id`,
      )
      .run({
        $id: id,
        $name: isDefault ? "Default" : i.name,
        $adapter: i.adapter_id,
        $model: i.model,
        $effort: i.effort,
        $skip: (i.skip_permissions ?? true) ? 1 : 0,
        $now: now,
      });
    if (res.changes === 0) throw new Error(`agent ${id} not found`);
    db.query("DELETE FROM agent_skills WHERE agent_id = ?").run(id);
    db.query("DELETE FROM agent_projects WHERE agent_id = ?").run(id);
    db.query("DELETE FROM agent_instructions WHERE agent_id = ?").run(id);
    writeRelations(db, id, isDefault ? { ...i, project_ids: [] } : i);
  });
  tx(input);
  return getAgent(db, id)!;
}

function writeRelations(db: Database, agentId: number, input: AgentInput): void {
  const instrStmt = db.query(
    `INSERT INTO agent_instructions (agent_id, name, body, position, is_entry)
     VALUES ($a, $name, $body, $pos, $entry)`,
  );
  input.instructions.forEach((instr, pos) => {
    instrStmt.run({
      $a: agentId,
      $name: instr.name.trim(),
      $body: instr.body,
      $pos: pos,
      $entry: instr.is_entry ? 1 : 0,
    });
  });
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

export function listAgents(db: Database, spaceId: number): Agent[] {
  const rows = db
    .query(
      "SELECT id FROM agents WHERE space_id = ? ORDER BY name COLLATE NOCASE",
    )
    .all(spaceId) as { id: number }[];
  return rows.map((r) => getAgent(db, r.id)!);
}

export function getAgent(db: Database, id: number): Agent | null {
  const row =
    (db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow) ?? null;
  if (!row) return null;

  const instructionRows = db
    .query(
      `SELECT id, name, body, position, is_entry FROM agent_instructions
       WHERE agent_id = ? ORDER BY position`,
    )
    .all(id) as (Omit<AgentInstruction, "is_entry"> & { is_entry: number })[];
  const instructions: AgentInstruction[] = instructionRows.map((r) => ({
    ...r,
    is_entry: r.is_entry === 1,
  }));

  const skills = db
    .query(
      `SELECT s.* FROM skills s
       JOIN agent_skills a ON a.skill_id = s.id
       WHERE a.agent_id = ? ORDER BY a.position`,
    )
    .all(id) as Skill[];

  // The Default agent is scoped to every project in its own Space, resolved live
  // so projects added after it was seeded are included automatically (its
  // agent_projects rows are never written). Others use their explicit project
  // list. Scoping by row.space_id keeps a Space's Default agent blind to other
  // Spaces' projects.
  const projects =
    row.is_default === 1
      ? (db
          .query(
            "SELECT * FROM projects WHERE space_id = ? ORDER BY name COLLATE NOCASE",
          )
          .all(row.space_id) as Project[])
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
    instructions,
    skills,
    projects,
  };
}

/** A Space's built-in Default agent (always present — seeded by migration v11
 *  for the initial Space and by createSpace for every Space after). */
export function getDefaultAgent(db: Database, spaceId: number): Agent {
  const row = db
    .query("SELECT id FROM agents WHERE is_default = 1 AND space_id = ?")
    .get(spaceId) as { id: number } | null;
  if (!row) throw new Error(`default agent missing for space ${spaceId}`);
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
  // Reassign to the Default agent of *this agent's own Space*, so an orphaned
  // task never jumps Spaces.
  const space = db
    .query("SELECT space_id FROM agents WHERE id = ?")
    .get(id) as { space_id: number } | null;
  if (!space) return; // already gone — nothing to reassign or delete
  const defaultId = getDefaultAgent(db, space.space_id).id;
  const tx = db.transaction(() => {
    db.query(
      `UPDATE tasks SET target_id = $default, updated_at = $now
       WHERE target_type = 'agent' AND target_id = $id`,
    ).run({ $default: defaultId, $now: now, $id: id });
    db.query("DELETE FROM agents WHERE id = ?").run(id);
  });
  tx();
}
