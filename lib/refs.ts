import type { Database } from "bun:sqlite";
import type { Ref } from "./types";

export type RefKind = "skill" | "project" | "model" | "agent" | "flow";

/**
 * List the entities that reference the given one. A non-empty result means
 * the entity cannot be deleted (delete is blocked while referenced).
 */
export function referencesTo(db: Database, kind: RefKind, id: number): Ref[] {
  switch (kind) {
    case "skill":
      return agentsVia(db, "agent_skills", "skill_id", id);
    case "project":
      return agentsVia(db, "agent_projects", "project_id", id);
    case "model":
      return db
        .query("SELECT name FROM agents WHERE model_id = ?")
        .all(id)
        .map((r: any) => ({ kind: "agent", name: r.name }));
    case "agent":
      return [
        ...db
          .query(
            `SELECT DISTINCT f.name FROM flows f
             JOIN flow_steps s ON s.flow_id = f.id WHERE s.agent_id = ?`,
          )
          .all(id)
          .map((r: any) => ({ kind: "flow", name: r.name })),
        ...db
          .query(
            "SELECT title FROM tasks WHERE target_type = 'agent' AND target_id = ?",
          )
          .all(id)
          .map((r: any) => ({ kind: "task", name: r.title })),
      ];
    case "flow":
      return db
        .query(
          "SELECT title FROM tasks WHERE target_type = 'flow' AND target_id = ?",
        )
        .all(id)
        .map((r: any) => ({ kind: "task", name: r.title }));
  }
}

function agentsVia(
  db: Database,
  table: string,
  col: string,
  id: number,
): Ref[] {
  return db
    .query(
      `SELECT a.name FROM agents a
       JOIN ${table} t ON t.agent_id = a.id WHERE t.${col} = ?`,
    )
    .all(id)
    .map((r: any) => ({ kind: "agent", name: r.name }));
}

/** Throw if the entity is referenced; used by delete functions. */
export function assertNotReferenced(
  db: Database,
  kind: RefKind,
  id: number,
): void {
  const refs = referencesTo(db, kind, id);
  if (refs.length > 0) {
    const desc = refs.map((r) => `${r.kind} "${r.name}"`).join(", ");
    throw new Error(`${kind} is referenced by: ${desc}`);
  }
}
