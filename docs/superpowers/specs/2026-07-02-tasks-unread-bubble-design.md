# Tasks unread bubble — design

## Goal

Show an unread count bubble on the "Tasks" link in the sidebar.
The count is the number of tasks that have settled into a state needing the user's attention and have not yet been looked at.

"Needs attention" means a task finished a turn and it is now the user's move: either reply to it or read the result.

## What counts as unread

A task is **unread** when both hold:

- Its status is `succeeded` or `failed`.
- The user has not opened it since it last settled.

Rationale for the status set:

- `succeeded` — the run ended a turn. In this app there is no distinct "awaiting input" status: an agent that asks the user a question and an agent that fully completes both land in `succeeded` (`lib/engine/runner.ts:113,166`).
  The last step keeps a `session_id`, which is what enables the reply box (`canReply = succeeded && session_id`, `app/tasks/[id]/run-view.tsx:78`).
  Either way it is the user's turn, so `succeeded` is the primary "needs attention" state.
- `failed` — something broke; the user should see it.
- `running` — still working, nothing the user can act on. Excluded.
- `stopped` — the user stopped it themselves, so they already know. Excluded.
- `pending` — never run. Excluded.

## Read / unread mechanism

Read state is per task and re-arms on each new settle ("key on latest settle").

Two nullable timestamp columns on `tasks`:

- `settled_at TEXT` — set to `now` each time the task transitions into a terminal status (`succeeded`, `failed`, `stopped`).
- `seen_at TEXT` — set to `now` when the user opens the task detail page.

Unread predicate:

```
status IN ('succeeded','failed')
AND settled_at IS NOT NULL
AND (seen_at IS NULL OR seen_at < settled_at)
```

Why a dedicated `settled_at` rather than reusing `updated_at`:
task editing is planned for later.
An edit will bump `updated_at`, and reusing it would falsely re-flag an already-read task as unread.
`settled_at` only moves on a terminal transition, so edits never disturb the unread state.

Re-run behaviour falls out for free: a re-run goes `running` (no `settled_at` change) then `succeeded`/`failed` (fresh `settled_at` > old `seen_at`), so the task becomes unread again. Each outcome earns attention exactly once.

## Data model changes

Migration (new version, following the existing rebuild-table pattern in `lib/db/migrations.ts`):

- Add `settled_at TEXT` and `seen_at TEXT` to `tasks` (both nullable, no default).
- Backfill so the badge starts clean rather than flooding on first load:
  - For rows already in a terminal status: `settled_at = updated_at` and `seen_at = updated_at`.
  - For non-terminal rows: leave both `NULL`.

## Repo changes (`lib/repos/tasks.ts`)

- `setTaskStatus` — when the new status is terminal (`succeeded` / `failed` / `stopped`), also set `settled_at = $now` in the same `UPDATE`. Non-terminal transitions leave `settled_at` untouched.
- `countUnreadTasks(db): number` — runs the unread predicate, returns the count.
- `markTaskSeen(db, id)` — `UPDATE tasks SET seen_at = $now WHERE id = $id`. Deliberately does **not** touch `updated_at` or `settled_at`.

All follow the repo conventions: `db` first parameter, `$named` params, ISO string timestamps, named exports.

## Server action (`app/actions.ts`)

- `markTaskSeenAction(id: number)` — calls `markTaskSeen(db(), id)`. Mutation, so it routes through an action per the layering rule (UI never calls a repo to write).

## Layout → Nav (`app/layout.tsx`, `app/nav.tsx`)

- Layout (already `force-dynamic`, already reads the DB per request) computes `unread = countUnreadTasks(database)` and passes it to `<Nav unread={unread} />`.
- `Nav` renders a bubble on the "Tasks" link when `unread > 0`. Display caps at `99+`.
- Bubble style: small red count pill, right-aligned within the Tasks link row. New CSS class in `globals.css` (e.g. `nav-badge`).

## Clearing (mark read)

`app/tasks/[id]/run-view.tsx` is the client component rendered at `/tasks/[id]`.

- On mount: `await markTaskSeenAction(task.id)`, then `router.refresh()` so the persistent layout re-runs and the badge drops. `router.refresh()` re-renders Server Components (including the layout) while preserving client state.
- On live-stream `done`: mark seen again, so a run that settles while the user is watching it does not immediately re-flag as unread.

## Freshness

The badge reflects server state on each request, updating on any navigation or `router.refresh()` — the same model the rest of the sidebar already uses.
No live SSE push to the badge.

## Out of scope

- Counting `stopped`, `running`, or `pending` tasks.
- Live push updates to the badge (SSE) while sitting on an unrelated page.
- Per-task mark-as-read controls or a "clear all" action.
- Any notification surface beyond the sidebar count (no toast, no list).

## Testing

- `lib/repos/tasks` unit tests (Bun, in-memory DB):
  - `setTaskStatus` sets `settled_at` on terminal transitions and leaves it on `running`/`pending`.
  - `markTaskSeen` sets `seen_at` without changing `updated_at` or `settled_at`.
  - `countUnreadTasks`: counts `succeeded`/`failed` unseen; excludes `stopped`/`running`/`pending`; excludes a task whose `seen_at >= settled_at`; re-counts a task after a fresh settle following a prior seen.
- Migration test: backfill leaves settled rows read (count 0) and non-terminal rows untouched.
