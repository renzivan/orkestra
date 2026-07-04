import type { Database } from "bun:sqlite";
import type { Flow } from "../types";
import { getAgent } from "./agents";

export interface FlowInput {
  name: string;
  agent_ids: number[];
}

interface FlowRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export function createFlow(
  db: Database,
  spaceId: number,
  input: FlowInput,
): Flow {
  const now = new Date().toISOString();
  const tx = db.transaction((i: FlowInput) => {
    const row = db
      .query(
        `INSERT INTO flows (name, space_id, created_at, updated_at)
         VALUES ($name, $space, $now, $now) RETURNING id`,
      )
      .get({ $name: i.name, $space: spaceId, $now: now }) as { id: number };
    writeSteps(db, row.id, i.agent_ids);
    return row.id;
  });
  return getFlow(db, tx(input))!;
}

export function updateFlow(db: Database, id: number, input: FlowInput): Flow {
  const now = new Date().toISOString();
  const tx = db.transaction((i: FlowInput) => {
    const res = db
      .query("UPDATE flows SET name = $name, updated_at = $now WHERE id = $id")
      .run({ $id: id, $name: i.name, $now: now });
    if (res.changes === 0) throw new Error(`flow ${id} not found`);
    db.query("DELETE FROM flow_steps WHERE flow_id = ?").run(id);
    writeSteps(db, id, i.agent_ids);
  });
  tx(input);
  return getFlow(db, id)!;
}

function writeSteps(db: Database, flowId: number, agentIds: number[]): void {
  const stmt = db.query(
    `INSERT INTO flow_steps (flow_id, agent_id, position)
     VALUES ($f, $a, $pos)`,
  );
  agentIds.forEach((agentId, pos) => {
    stmt.run({ $f: flowId, $a: agentId, $pos: pos });
  });
}

export function listFlows(db: Database, spaceId: number): Flow[] {
  const rows = db
    .query("SELECT id FROM flows WHERE space_id = ? ORDER BY name COLLATE NOCASE")
    .all(spaceId) as { id: number }[];
  return rows.map((r) => getFlow(db, r.id)!);
}

export function getFlow(db: Database, id: number): Flow | null {
  const row =
    (db.query("SELECT * FROM flows WHERE id = ?").get(id) as FlowRow) ?? null;
  if (!row) return null;
  const stepAgents = db
    .query("SELECT agent_id FROM flow_steps WHERE flow_id = ? ORDER BY position")
    .all(id) as { agent_id: number }[];
  const agents = stepAgents.map((s) => getAgent(db, s.agent_id)!);
  return { ...row, agents };
}

/** Delete a flow; its steps are removed and tasks that target it become
 *  non-runnable (FK cascade + runtime check). */
export function deleteFlow(db: Database, id: number): void {
  db.query("DELETE FROM flows WHERE id = ?").run(id);
}
