# Allow delete, guard at run time

## Problem

Today deleting a skill, project, adapter, agent, or flow is blocked whenever something still references it.
Two layers enforce this:

1. **App layer** — `assertNotReferenced(db, kind, id)` in `lib/refs.ts`, called by every `deleteX` repo function, throws if `referencesTo` returns any rows.
2. **DB layer** — `PRAGMA foreign_keys = ON` plus foreign keys with no `ON DELETE` action: `agent_skills.skill_id`, `agent_projects.project_id`, `flow_steps.agent_id`, `agents.adapter_id`. Even without the app guard, deleting a referenced parent would fail at the DB.

The user wants the opposite model: **delete always succeeds; downstream degrades**.
A task whose target no longer resolves must not run — it should be visibly non-runnable with a reason, rather than blocked at delete time or crashing mid-run.

## Behaviour

Deletion is never blocked by references. Effects of each delete:

| Delete    | Effect on downstream |
|-----------|----------------------|
| skill     | Dropped from every agent's skill list. Agent still runs, with a shorter system prompt. |
| project   | Dropped from every agent's project list. Agent still runs, with one less repo path. |
| adapter   | Every agent using it has `adapter_id` set to NULL. Those agents become non-runnable until a new adapter is assigned. |
| agent     | Dropped from any flow step it appears in (the flow shrinks and stays runnable). Tasks targeting that agent become non-runnable. |
| flow      | Its steps are removed (already cascades today). Tasks targeting that flow become non-runnable. |

A task is **non-runnable** when any of these hold:

- Its target agent no longer exists.
- Its target flow no longer exists.
- Its target flow has zero steps.
- Its target agent, or any agent in its target flow, has no adapter (`adapter_id IS NULL`).

Non-runnable is a UI + server-action gate, not a stored task state.
It is recomputed from current data every time, so reassigning an adapter or editing a flow makes the task runnable again with no extra bookkeeping.

## Design

### 1. Migration v8 — foreign-key actions

SQLite cannot alter a foreign key or a column's nullability in place, so affected tables are rebuilt with the create-new → copy → drop → rename pattern already used by migration v6, wrapped in `PRAGMA foreign_keys=OFF` / `ON`.

Tables rebuilt and their new foreign-key actions:

- `agent_skills` — `skill_id` gains `ON DELETE CASCADE` (keep `agent_id ON DELETE CASCADE`).
- `agent_projects` — `project_id` gains `ON DELETE CASCADE` (keep `agent_id ON DELETE CASCADE`).
- `flow_steps` — `agent_id` gains `ON DELETE CASCADE` (keep `flow_id ON DELETE CASCADE`).
- `agents` — `adapter_id` becomes nullable and gains `ON DELETE SET NULL`.

`SELECT *` order must be preserved on rebuilt tables, matching the v6 precedent (including all columns added in v2–v5 for `agents`).

Note: dropping agent steps from a flow can reorder or leave gaps in `flow_steps.position`.
`resolveAgents` reads steps ordered by position and does not require them to be contiguous, so gaps are harmless. No renumbering needed.

### 2. Drop the app-level guard

Remove the `assertNotReferenced(...)` call from all five repo delete functions:
`deleteSkill`, `deleteProject`, `deleteAdapter`, `deleteAgent`, `deleteFlow`.

Keep `referencesTo` and `assertNotReferenced` in `lib/refs.ts`:

- `referencesTo` is still used by `lib/adapters/sync.ts` and now feeds the delete-confirmation warning (section 5).
- `assertNotReferenced` becomes unused by repos; leave it exported for now (it is small and may be reused). Remove only if lint flags it.

### 3. Runnable check — `lib/runnable.ts`

New module with one exported function:

```ts
export function taskRunnable(db: Database, task: Task): { ok: boolean; reason?: string };
```

Logic:

- `target_type === "agent"`: load the agent. Missing → `{ ok: false, reason: "agent was deleted" }`. `adapter_id == null` → `{ ok: false, reason: "agent has no adapter" }`. Else ok.
- `target_type === "flow"`: load the flow. Missing → reason "flow was deleted". `agents.length === 0` → reason "flow has no steps". Any agent with `adapter_id == null` → reason `` `step agent "<name>" has no adapter` ``. Else ok.

Reuses existing repo getters (`getAgent`, `getFlow`, which already resolve nested agents). No new SQL.

### 4. Type change

`Agent.adapter_id: number | null` in `lib/types.ts`.
`getAgent` already spreads the row; adapter_id will simply be null when set-null fired.
The runner's existing `if (!adapter) throw new Error('agent "<name>" has no adapter')` stays as a last-resort defense; the pre-run gate should normally prevent reaching it.

### 5. Delete-confirmation warning

New server action in `app/actions.ts`:

```ts
export async function referencesToAction(kind: RefKind, id: number): Promise<Ref[]>;
```

Each `*-form.tsx` delete handler (`agent-form`, `flow-form`, `project-form`, `skill-form`) calls it before showing the confirm dialog and, when the result is non-empty, folds the references into the confirm `message`:

```
Delete "Linter"?

Used by:
  • flow "Review"
  • task "Fix login"

These will be updated or blocked. This can't be undone.
```

When there are no references, the message is unchanged from today.
The confirm dialog `message` is a plain string, so the list is rendered as newline-separated text (`white-space: pre-line` on the message element if not already wrapping). No dialog API change required beyond that styling nicety.

Adapters have no delete UI (they are synced presets), so no adapter form change is needed.

### 6. Gate the Run buttons

**Task detail** (`app/tasks/[id]/page.tsx` → `run-view.tsx`):

- Page computes `const runnable = taskRunnable(database, task)` and passes it to `RunView`.
- `RunView` disables the Run / Re-run / Resume buttons when `!runnable.ok` and shows `runnable.reason` (e.g. a muted line next to the disabled button). Reply is unaffected (it resumes an existing CLI session, not the target).

**Task list** (`app/tasks/page.tsx` → `tasks-client.tsx`):

- Page computes runnable per task server-side and passes a map (or annotates each task) to `TasksClient`.
- The row's Run button is disabled when not runnable, with the reason as a `title` tooltip.

**Server defense** (`app/actions.ts` `runTaskAction`):

- Before setting status to running and firing `runTask`, call `taskRunnable`. If not ok, return `{ ok: false, error: reason }` (widen the return type) and do not start a run. This backstops a stale client.

## Testing

- **Migration v8**: open a DB at v7 with agents/flows/tasks wired up, run migrations, assert schema (foreign-key actions via `PRAGMA foreign_key_list`) and that all rows survive the rebuild.
- **Cascade behaviour** (repo tests):
  - Delete a skill/project → agent loses it, agent row intact.
  - Delete an adapter → using agents have `adapter_id === null`, rows intact.
  - Delete an agent in a flow → its `flow_steps` row gone, other steps intact, flow still present.
  - Delete a flow → steps gone, tasks targeting it still present.
- **`taskRunnable`**: table-driven cases for each reason and the ok case, including a flow with a null-adapter step agent and an empty flow.
- **`runTaskAction`**: returns an error and starts no run when the task is non-runnable.
- Existing `refs.test.ts` expectations that delete throws-when-referenced are removed or inverted to assert delete now succeeds.

## Out of scope

- Task deletion UI. Tasks are leaves (only `runs` reference them, already `ON DELETE CASCADE`); there is no `deleteTask` today and none is added here.
- Renumbering `flow_steps.position` after a gap.
- Any change to adapter management (still synced presets, no CRUD UI).
