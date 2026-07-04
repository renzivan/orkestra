import type { Database } from "bun:sqlite";
import type { Space } from "../types";

export interface SpaceInput {
  name: string;
}

export type DeleteSpaceResult = { ok: true } | { ok: false; error: string };

export function listSpaces(db: Database): Space[] {
  return db
    .query("SELECT * FROM spaces ORDER BY name COLLATE NOCASE")
    .all() as Space[];
}

export function getSpace(db: Database, id: number): Space | null {
  return (db.query("SELECT * FROM spaces WHERE id = ?").get(id) as Space) ?? null;
}

/** The earliest Space by id. Always present (migration v11 seeds one and
 *  deleteSpace refuses to remove the last), so callers can rely on it as the
 *  active-Space fallback when no valid one is selected. */
export function defaultSpace(db: Database): Space {
  const row = db
    .query("SELECT * FROM spaces ORDER BY id LIMIT 1")
    .get() as Space | null;
  if (!row) throw new Error("no spaces exist");
  return row;
}

/**
 * Create a Space and make it immediately usable: in one transaction, insert the
 * Space, seed its own Settings row (defaults), and seed its own built-in Default
 * agent (mirrors migration v9 — undeletable, adapterless, one per Space). Without
 * the seed a new Space would have no Default agent to preselect on tasks and no
 * settings row to read run behaviour from.
 */
export function createSpace(db: Database, input: SpaceInput): Space {
  const now = new Date().toISOString();
  const tx = db.transaction((name: string) => {
    const space = db
      .query(
        `INSERT INTO spaces (name, created_at, updated_at)
         VALUES ($name, $now, $now) RETURNING *`,
      )
      .get({ $name: name, $now: now }) as Space;
    db.query(
      `INSERT INTO settings (space_id, retries, step_timeout_seconds, task_prefix)
       VALUES ($space, 1, 600, '')`,
    ).run({ $space: space.id });
    const agent = db
      .query(
        `INSERT INTO agents
           (name, adapter_id, model, effort, skip_permissions,
            is_default, space_id, created_at, updated_at)
         VALUES ('Default', NULL, '', '', 1, 1, $space, $now, $now) RETURNING id`,
      )
      .get({ $space: space.id, $now: now }) as { id: number };
    // Every agent has at least one instruction file with exactly one entry
    // (migration v12 model); seed the Default's empty entry 'AGENTS.md' to match.
    db.query(
      `INSERT INTO agent_instructions (agent_id, name, body, position, is_entry)
       VALUES ($a, 'AGENTS.md', '', 0, 1)`,
    ).run({ $a: agent.id });
    return space;
  });
  return tx(input.name);
}

export function renameSpace(db: Database, id: number, name: string): Space {
  const now = new Date().toISOString();
  const row = db
    .query(
      `UPDATE spaces SET name = $name, updated_at = $now
       WHERE id = $id RETURNING *`,
    )
    .get({ $id: id, $name: name, $now: now }) as Space | null;
  if (!row) throw new Error(`space ${id} not found`);
  return row;
}

/**
 * Delete a Space and everything scoped to it — its projects, skills, agents,
 * flows, tasks (and their runs), and settings row — via FK ON DELETE CASCADE.
 * Refuses to delete the last remaining Space: the app assumes at least one
 * always exists (defaultSpace, the active-Space fallback). Adapters are global
 * and untouched.
 */
export function deleteSpace(db: Database, id: number): DeleteSpaceResult {
  const count = (
    db.query("SELECT COUNT(*) AS n FROM spaces").get() as { n: number }
  ).n;
  if (count <= 1) {
    return { ok: false, error: "Can't delete the last space." };
  }
  db.query("DELETE FROM spaces WHERE id = ?").run(id);
  return { ok: true };
}
