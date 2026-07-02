# Default Agent — Design

## Problem

Tasks target an agent or a flow.
Deleting an agent currently leaves any task that targeted it pointing at nothing, so the task becomes non-runnable ("agent was deleted").
There is also no frictionless target for a new task — the New Task modal defaults to a flow and forces the user to pick a target every time.

We want a built-in **Default agent** that:

- always exists and cannot be deleted;
- is preselected as the target when creating a task;
- absorbs orphaned tasks: when a normal agent is deleted, tasks that targeted it are reassigned to the Default agent instead of going non-runnable;
- starts with an empty base instruction, and is scoped to *all* projects, but is otherwise configurable (the user picks its adapter/model so it can run).

## Requirements

1. A single Default agent exists in every database (seeded).
2. It cannot be deleted (guarded server-side; delete UI hidden).
3. Its name is fixed to `Default` (locked in the form and enforced server-side).
4. Its base instruction starts empty; adapter, model, effort, skip_permissions, skills, and instruction are all editable.
5. Its projects are not editable — it is scoped to **all projects**, resolved live so newly-added projects are included automatically.
6. Every new task preselects the Default agent as its target (`target_type = "agent"`, `target_id = <default id>`). Flows and other agents remain selectable.
7. When a normal agent is deleted, every task directly targeting it is reassigned to the Default agent. Flow behaviour is unchanged (the agent's flow steps still cascade-drop).

## Design

Chosen approach: an `is_default` flag on the agent (single source of truth) + live "all projects" resolution.

### Schema — migration v9

- `ALTER TABLE agents ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`.
- `CREATE UNIQUE INDEX agents_one_default ON agents(is_default) WHERE is_default = 1` — guarantees at most one default.
- Seed the Default row:
  `name='Default'`, `base_instruction=''`, `adapter_id=NULL`, `model=''`, `effort=''`, `skip_permissions=1`, `is_default=1`, timestamps via `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- The seeded row has a NULL adapter, so it is non-runnable until the user picks an adapter/model — matching "instructions empty, user can change models".

The column is added with `ALTER TABLE ADD COLUMN`, not a table rebuild, so it appends at the end and `getAgent`'s `SELECT *` spread stays order-independent.

### Repo — `lib/repos/agents.ts`

- `Agent` and `AgentRow` gain `is_default: boolean` (SQLite `0/1` mapped to boolean in `getAgent`).
- `getAgent`: when the row is the default, its `projects` are resolved live from the full `projects` table (ordered by name), ignoring any `agent_projects` rows.
- New `getDefaultAgent(db): Agent` — returns the flagged agent.
- `createAgent`: always inserts `is_default = 0` (there is no UI path to create another default).
- `updateAgent`: when editing the default agent, force `name = 'Default'`, preserve `is_default = 1`, and skip writing `agent_projects` (projects stay "all"). Everything else applies normally.
- `deleteAgent`: throw `"The default agent can't be deleted."` when the target is default. Otherwise, in a single transaction: reassign then delete.
  - Reassign: `UPDATE tasks SET target_id = <defaultId>, updated_at = <now> WHERE target_type = 'agent' AND target_id = <deletedId>`.
  - Delete: `DELETE FROM agents WHERE id = <deletedId>` (flow steps cascade as today).

Reassignment scope is only tasks *directly* targeting the deleted agent.
Tasks that target a flow are untouched; the deleted agent's flow steps drop via the existing v8 cascade.

### UI

- `app/agents/agent-form.tsx`:
  - When `agent.is_default`: disable the Name input, hide the Delete button, and replace the Projects chips with a locked "All projects" note.
  - All other fields stay editable.
- `app/delete-warning.ts`: for an agent delete, reword the impact so tasks read as "will be reassigned to Default" rather than "may become non-runnable". (Flows still read as shrinking.)
- New Task modal (`app/tasks/tasks-client.tsx` + `app/tasks/page.tsx`):
  - `TasksPage` passes `defaultAgentId` (from `getDefaultAgent`) to `TasksClient`.
  - The modal's initial state is `target_type = "agent"`, `target_id = defaultAgentId`. Flows and other agents remain selectable via the existing dropdowns.

### Runtime

No change to the runner or template.
They already read `agent.projects.map(p => p.path)`; the default agent simply returns the full project set from `getAgent`.

## Testing

Repo tests (`test/repos/agents.test.ts` and/or a new file):

- The Default agent is seeded and present after migrations.
- `getDefaultAgent` returns it; `is_default` is true.
- `deleteAgent` on the default throws and leaves it intact.
- `deleteAgent` on a normal agent reassigns tasks that targeted it to the Default agent (and cascades its flow steps).
- `getAgent` returns *all* projects for the default agent, including projects added after it was seeded.
- `updateAgent` on the default preserves `name` and `is_default` and does not write `agent_projects`.

Existing runnable/runner tests must stay green (the default with no adapter is simply non-runnable).

## Out of scope

- Changing which agent is the default (there is exactly one built-in default).
- Reassigning flow-targeted tasks on agent delete (flows keep existing cascade behaviour).
- Pinning the Default agent to the top of the sidebar list (it sorts alphabetically like any other agent).
