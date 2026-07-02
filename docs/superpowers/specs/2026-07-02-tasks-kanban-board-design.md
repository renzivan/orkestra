# Tasks page as a Kanban board

## Problem

The tasks page is a single vertical table: a "New task" form card on top, then rows of tasks with a status badge and Run/View buttons.
It gives no at-a-glance sense of how work is distributed across states.
A board grouped by status makes the pipeline visible and lets a task be run by dragging it into the Running column.

## Constraint that shapes the design

Task status is owned by the run engine, not the user.
`runTaskAction` moves a task pending → running, and the runner lands it in succeeded / failed / stopped.
There is no "manually set status" concept, and inventing one would desync the board from real run state.

So the board is grouped by status and is **mostly read-only**, with exactly one interactive drag: dropping a card onto **Running** runs it (identical to clicking Run/Re-run).
Every other drop snaps back.

## Behaviour

**Columns** (left → right): Pending · Running · Succeeded · Failed · Stopped.
Each column header shows its title and a count. Empty columns still render (so drop targets exist and the layout is stable).
The board scrolls horizontally inside its own container if the viewport is narrow; the page body never scrolls sideways.

**Cards** show: task label (`<prefix>-<id>: title`), target (`agent: name` / `flow: name`), and actions (Run/Re-run + View). The whole card links to the task detail on click of the title/body; buttons stop propagation.

**Drag to run:**

- Cards in Pending, Succeeded, Failed, Stopped are `draggable`.
- The Running column is a drop target. Dropping a draggable card there calls `runTaskAction(taskId)`; on `{ ok: true }` the client optimistically shows the card as running and calls `router.refresh()`. On `{ ok: false }` it surfaces the reason and does not move the card.
- Dropping on any other column, or dragging a Running card, does nothing (snap back). Running cards are not `draggable`.
- Non-runnable tasks (deleted target / missing adapter — from the existing `taskRunnable`) are not draggable and their Run button stays disabled with the reason as a tooltip, exactly as today.
- Native HTML5 drag-and-drop (`draggable`, `onDragStart`, `onDragOver` + `preventDefault`, `onDrop`). No library. A `drop-target` class highlights the Running column while a valid card is dragged over it.

**New task:** a `+ New Task` button in the page header opens the existing form (title, details, target type, target) inside a modal built on the existing `.overlay` / `.dialog` styles. Creating a task closes the modal and refreshes. The empty-state hint ("create a flow or agent first") moves into the modal / disables the button when there are no targets.

## Components

`app/tasks/tasks-client.tsx` is refactored from one component into small, focused pieces in the same file (it is a single client island):

- `TasksClient` — owns data props (`tasks`, `flows`, `agents`, `prefix`, `runnable`), groups tasks by status, renders the header + board + modal, and holds the run/create handlers.
- `Board` — renders the five `Column`s.
- `Column` — one status column: header with count, drop handling (only the Running column acts on drop), and its list of `TaskCard`s.
- `TaskCard` — one task: label, target, actions, `draggable` wiring.
- `NewTaskModal` — the extracted create form in a dialog.

Data flow is unchanged from today: the server component (`app/tasks/page.tsx`) already passes `tasks`, `flows`, `agents`, `prefix`, and the `runnable` map. Grouping by status happens client-side so an optimistic run can re-bucket a card without a round trip.

## Styling

New classes in `app/globals.css`, reusing existing tokens (`--s-*`, `--line`, status colors) and the `.overlay`/`.dialog` modal:

- `.board` — horizontal flex, `gap: var(--s-3)`, `overflow-x: auto`, columns don't shrink.
- `.board-col` — vertical flex, fixed min-width (~260px), subtle column background/border.
- `.board-col-head` — title + count row.
- `.board-col.drop-target` — highlighted border/background while a valid drag is over Running.
- `.task-card` — card surface, `cursor: grab` when draggable; a `.dragging` state lowers opacity.
- Column header accent per status can reuse the existing badge colors.

## Testing

The drag/board logic is presentational; the runnable + run-action logic is already unit-tested.
Coverage here is:

- **Manual E2E in the browser** (dev server): create tasks against an agent, confirm they appear in Pending; drag one onto Running and confirm a run starts and the card moves; confirm a card in Succeeded can be dragged back to Running to re-run; confirm a non-runnable task (delete its agent) is not draggable and its Run button is disabled with the reason; confirm the New Task modal creates a task; confirm the board scrolls horizontally on a narrow window without the page scrolling sideways.
- No new automated tests: no new pure functions are introduced (grouping is a trivial `groupBy(status)`), and the existing action/runnable tests already cover the behaviour a drop triggers. If grouping is extracted to a helper, add a one-line unit test for it.

## Out of scope

- Persisting column order or manual task ordering within a column.
- Any status the engine doesn't already produce.
- Reordering/prioritising tasks.
- Touch-specific drag (native DnD only; the Run button remains the universal fallback).
