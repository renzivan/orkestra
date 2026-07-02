# Delete tasks — design

## Goal

Let the user delete tasks, from both the kanban board and the task detail page.
Deleting a running task stops its live run first, leaving no orphan process.

## Background

Tasks are the run units of the app: a task targets a flow or agent, and running
it produces `runs` (each with `run_steps`).
The delete pattern for other entities is already established:

- Repo function `deleteX(db, id)` runs the SQL delete.
- Server action `deleteXAction(id)` wraps it in `tryDelete`, which catches errors
  and revalidates the list path, returning `DeleteResult`.
- The form calls `deleteConfirmMessage(kind, id, name)` + the `useConfirm` dialog
  before invoking the action.

Schema facts that make task deletion clean:

- `runs.task_id` is `REFERENCES tasks(id) ON DELETE CASCADE`.
- `run_steps.run_id` is `REFERENCES runs(id) ON DELETE CASCADE`.

So `DELETE FROM tasks WHERE id = ?` removes the task, its runs, and their steps
in one statement. No manual child cleanup.

A task is a leaf in the reference graph: nothing points at a task (unlike flows
or skills, which agents/tasks reference).
So the `referencesTo` machinery is not needed for task deletion — the confirm
message is a plain one-liner.

## Running-task handling

A running task has a live subprocess tracked in the engine registry
(`lib/engine/registry.ts`).
`stop(runId)` sets the run's `aborted` flag and sends SIGTERM to the process.

The delete action, when the task is `running`, resolves the latest run and calls
`stop()` on it before deleting the task.

Ordering is safe: after `stop()` the subprocess exits asynchronously, and the
runner's terminal-state write (`UPDATE runs/tasks SET status = 'stopped' …`)
targets rows that the cascade delete has already removed.
In SQLite an `UPDATE … WHERE id = ?` that matches no row is a no-op, not an
error, so the fire-and-forget runner callback stays harmless.

## Data layer — `lib/repos/tasks.ts`

```ts
/** Delete a task; its runs and run_steps are removed by FK cascade. */
export function deleteTask(db: Database, id: number): void {
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
}
```

## Action — `app/actions.ts`

```ts
export async function deleteTaskAction(id: number): Promise<DeleteResult> {
  const task = Tasks.getTask(db(), id);
  // A live run holds a subprocess — kill it before the row cascades away, or the
  // process is orphaned. stop() is a safe no-op if the run isn't tracked.
  if (task?.status === "running") {
    const latest = latestRunForTask(db(), id);
    if (latest) stop(latest.id);
  }
  return tryDelete(() => Tasks.deleteTask(db(), id), "/tasks");
}
```

`latestRunForTask` is already imported in the runner path; import it into
`actions.ts` from `@/lib/repos/runs`. `stop` is already imported from
`@/lib/engine/registry`.

## Confirm message

Task deletion does not go through `deleteConfirmMessage` (that helper is for
entities other things reference). The forms build the message inline:

- Not running: `Delete "<label>"? This can't be undone.`
- Running: append `\n\nThis task is running and will be stopped.`

`<label>` is `taskLabel(prefix, id, title)`.

## UI — detail page

`app/tasks/[id]/page.tsx` renders the header; the interactive Delete button lives
in the client `run-view.tsx` (the page is a server component).
Add a `Delete` button (class `btn small danger`) to the detail header, wired
through `useConfirm`.
On success → `router.push("/tasks")` then `router.refresh()`.
On failure → surface the error in the existing run-view error area.

## UI — kanban card

`app/tasks/tasks-client.tsx`: add a small `Delete` button to
`.task-card-actions`, after Run and View.
Clicking it opens the confirm dialog; on confirm it calls `deleteTaskAction` and
`router.refresh()`.
Errors surface in the board-level `error` state already rendered near the top.

`TasksClient` gains the `useConfirm` hook (rendered dialog + `confirm()`), passed
down to `TaskCard` as an `onDelete(task)` callback so the card stays presentational.

## Testing

Repo (`bun test`):

- `deleteTask` removes the task row.
- Deleting a task cascades: its `runs` and `run_steps` rows are gone.

Action:

- Deleting a `running` task calls `stop()` on its latest run before deleting.
- Deleting a non-running task does not call `stop()`.
- Deleting a task mid-run leaves no orphan `runs` rows for that task.

## Out of scope

- Bulk / multi-select delete.
- Undo / soft-delete / trash.
- Confirmations beyond the single dialog.
