# Delete Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user delete tasks from the kanban board and the task detail page, stopping any live run first.

**Architecture:** A `deleteTask` repo function issues one `DELETE FROM tasks` — `runs` and `run_steps` cascade off existing FKs. The `deleteTaskAction` server action stops the latest run when the task is running (kills the live subprocess), then delegates to the shared `tryDelete` helper. Two UI entry points (kanban card, detail-page button) call the action through the existing `useConfirm` dialog.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Bun + `bun:sqlite`, `bun test`.

## Global Constraints

- Runtime: Bun; SQLite via `bun:sqlite`. Tests run with `bun test`.
- `openDb` sets `PRAGMA foreign_keys = ON` — FK cascades are active in tests and prod.
- Server actions live in `app/actions.ts` (`"use server"`), return `DeleteResult = { ok: true } | { ok: false; error: string }` for deletes.
- Delete confirmation uses the existing `useConfirm()` hook from `app/confirm-dialog.tsx` (render `dialog`, `await confirm({ title, message })`).
- Task display label = `taskLabel(prefix, id, title)` from `lib/repos/tasks.ts`.
- No lint step exists; verification = `bun test`, `bun run typecheck`, `bun run build`.
- Commit directly to `main`. Do NOT push (the human pushes; project rule).

---

### Task 1: `deleteTask` repo function

**Files:**
- Modify: `lib/repos/tasks.ts` (append after `getTask`, ~line 50)
- Test: `test/repos/tasks.test.ts` (create)

**Interfaces:**
- Consumes: `startRun(db, taskId): Run` from `lib/repos/runs.ts`; `createTask(db, input): Task` from `lib/repos/tasks.ts`.
- Produces: `deleteTask(db: Database, id: number): void`.

- [ ] **Step 1: Write the failing test**

Create `test/repos/tasks.test.ts`:

```ts
import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Tasks from "../../lib/repos/tasks";
import { startRun } from "../../lib/repos/runs";

test("deleteTask removes the task and cascades its runs", () => {
  const db = openDb(":memory:");

  const task = Tasks.createTask(db, {
    title: "T",
    body: "b",
    target_type: "agent",
    target_id: 1,
  });
  const run = startRun(db, task.id);

  // sanity: the run exists and points at the task
  expect(
    (db.query("SELECT COUNT(*) AS n FROM runs WHERE task_id = ?").get(task.id) as { n: number }).n,
  ).toBe(1);

  Tasks.deleteTask(db, task.id);

  expect(Tasks.getTask(db, task.id)).toBeNull();
  expect(
    (db.query("SELECT COUNT(*) AS n FROM runs WHERE id = ?").get(run.id) as { n: number }).n,
  ).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/repos/tasks.test.ts`
Expected: FAIL — `Tasks.deleteTask is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/repos/tasks.ts`:

```ts
/** Delete a task; its runs and run_steps are removed by FK cascade. */
export function deleteTask(db: Database, id: number): void {
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/repos/tasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repos/tasks.ts test/repos/tasks.test.ts
git commit -m "feat: deleteTask repo fn (cascades runs)"
```

---

### Task 2: `deleteTaskAction` server action

**Files:**
- Modify: `app/actions.ts` (imports near top; new action in the `// ---- Tasks ----` section, ~after line 179)
- Test: `test/actions.test.ts` (append two tests)

**Interfaces:**
- Consumes: `Tasks.deleteTask`, `Tasks.getTask`, `Tasks.createTask` (`lib/repos/tasks.ts`); `latestRunForTask(db, taskId): Run | null` and `startRun(db, taskId): Run` (`lib/repos/runs.ts`); `stop(runId): void`, `register(runId): void`, `isAborted(runId): boolean` (`lib/engine/registry.ts`); `tryDelete`, `DeleteResult` (`app/actions.ts`).
- Produces: `deleteTaskAction(id: number): Promise<DeleteResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `test/actions.test.ts`:

```ts
test("deleteTaskAction removes the task and its runs", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");

  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  Runs.startRun(db(), task.id);

  const res = await A.deleteTaskAction(task.id);
  expect(res.ok).toBe(true);
  expect(Tasks.getTask(db(), task.id)).toBeNull();
  expect(Runs.latestRunForTask(db(), task.id)).toBeNull();
});

test("deleteTaskAction stops the live run of a running task", async () => {
  const { db } = await import("../lib/db");
  const A = await import("../app/actions");
  const Tasks = await import("../lib/repos/tasks");
  const Runs = await import("../lib/repos/runs");
  const Registry = await import("../lib/engine/registry");

  const task = await A.createTaskAction({
    title: "t",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db(), task.id);
  Tasks.setTaskStatus(db(), task.id, "running");
  Registry.register(run.id); // simulate a live run tracked by the engine

  const res = await A.deleteTaskAction(task.id);
  expect(res.ok).toBe(true);
  // stop() flagged the run aborted before the row cascaded away
  expect(Registry.isAborted(run.id)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/actions.test.ts`
Expected: FAIL — `A.deleteTaskAction is not a function`.

- [ ] **Step 3: Add the import**

In `app/actions.ts`, the runner imports already include `stop` from `@/lib/engine/registry` (line 12). Add `latestRunForTask` to the runs usage — `app/actions.ts` imports repos as namespaces, so add this import near the other `import * as` lines (after line 10):

```ts
import { latestRunForTask } from "@/lib/repos/runs";
```

- [ ] **Step 4: Write the action**

In `app/actions.ts`, in the `// ---- Tasks ----` section (after `createTaskAction`, ~line 179), add:

```ts
export async function deleteTaskAction(id: number): Promise<DeleteResult> {
  const task = Tasks.getTask(db(), id);
  // A live run holds a subprocess — kill it before the row cascades away, or the
  // process is orphaned. stop() is a safe no-op if the run isn't tracked; the
  // runner's later terminal-write targets already-deleted rows (a no-op UPDATE).
  if (task?.status === "running") {
    const latest = latestRunForTask(db(), id);
    if (latest) stop(latest.id);
  }
  return tryDelete(() => Tasks.deleteTask(db(), id), "/tasks");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/actions.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add app/actions.ts test/actions.test.ts
git commit -m "feat: deleteTaskAction stops live run then deletes"
```

---

### Task 3: Delete button on kanban cards

**Files:**
- Modify: `app/tasks/tasks-client.tsx`

**Interfaces:**
- Consumes: `deleteTaskAction(id)` (`app/actions.ts`); `useConfirm()` (`app/confirm-dialog.tsx`); `taskLabel(prefix, id, title)` (`lib/repos/tasks.ts`).
- Produces: no exports; adds an `onDelete(task)` prop to the internal `TaskCard`.

This task is UI wiring with no unit-test harness for client components — verified by typecheck + build and a manual smoke check. Keep `TaskCard` presentational: the confirm dialog and action call live in `TasksClient`.

- [ ] **Step 1: Import the action and confirm hook**

At the top of `app/tasks/tasks-client.tsx`, extend the actions import (line 9) and add the confirm hook import:

```ts
import { createTaskAction, runTaskAction, deleteTaskAction } from "../actions";
import { useConfirm } from "../confirm-dialog";
```

- [ ] **Step 2: Wire the hook and delete handler in `TasksClient`**

Inside `TasksClient`, after `const router = useRouter();` (line 39) add:

```ts
  const { confirm, dialog } = useConfirm();
```

Then, after the `run`/`runById` helpers (~line 67), add:

```ts
  async function remove(t: Task) {
    setError("");
    const running = t.status === "running";
    const message = running
      ? `Delete "${taskLabel(prefix, t.id, t.title)}"?\n\nThis task is running and will be stopped.\n\nThis can't be undone.`
      : `Delete "${taskLabel(prefix, t.id, t.title)}"? This can't be undone.`;
    if (!(await confirm({ title: "Delete task", message }))) return;
    const res = await deleteTaskAction(t.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }
```

- [ ] **Step 3: Render the dialog and pass `onDelete` to each card**

At the top of the returned JSX, render the dialog. Change the opening of the return (line 72-73) from:

```tsx
  return (
    <div className="board-page">
```

to:

```tsx
  return (
    <div className="board-page">
      {dialog}
```

In the `TaskCard` render (the `.map` at ~line 116-133), add the `onDelete` prop:

```tsx
                  <TaskCard
                    key={t.id}
                    task={t}
                    label={taskLabel(prefix, t.id, t.title)}
                    target={`${t.target_type}: ${targetName(t)}`}
                    blocked={blocked}
                    reason={blocked ? r.reason : undefined}
                    dragging={draggingId === t.id}
                    onRun={() => run(t)}
                    onDelete={() => remove(t)}
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
```

- [ ] **Step 4: Add the `onDelete` prop and button to `TaskCard`**

Update `TaskCard`'s prop type and signature (~line 201-221) to include `onDelete: () => void` alongside `onRun`:

```tsx
function TaskCard({
  task,
  label,
  target,
  blocked,
  reason,
  dragging,
  onRun,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  label: string;
  target: string;
  blocked: boolean;
  reason?: string;
  dragging: boolean;
  onRun: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
```

In the `.task-card-actions` block (~line 244-256), add a Delete button after the View link:

```tsx
      <div className="task-card-actions">
        <button
          className="btn small primary"
          onClick={onRun}
          disabled={task.status === "running" || blocked}
          title={blocked ? reason : undefined}
        >
          {task.status === "running" ? "Running…" : task.status === "pending" ? "Run" : "Re-run"}
        </button>
        <Link className="btn small" href={`/tasks/${task.id}`}>
          View
        </Link>
        <button className="btn small danger" onClick={onDelete}>
          Delete
        </button>
      </div>
```

- [ ] **Step 5: Verify typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: both succeed, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/tasks/tasks-client.tsx
git commit -m "feat: delete button on task kanban cards"
```

---

### Task 4: Delete button on the task detail page

**Files:**
- Create: `app/tasks/[id]/delete-task-button.tsx`
- Modify: `app/tasks/[id]/page.tsx`

**Interfaces:**
- Consumes: `deleteTaskAction(id)` (`app/actions.ts`); `useConfirm()` (`app/confirm-dialog.tsx`); `Task` type (`@/lib/types`); `taskLabel` (`lib/repos/tasks.ts`).
- Produces: `DeleteTaskButton({ task, label }: { task: Task; label: string })` default-free named export.

Client component because `page.tsx` is a server component. Verified by typecheck + build.

- [ ] **Step 1: Create the client component**

Create `app/tasks/[id]/delete-task-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { deleteTaskAction } from "../../actions";
import { useConfirm } from "../../confirm-dialog";

export function DeleteTaskButton({ task, label }: { task: Task; label: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const running = task.status === "running";
    const message = running
      ? `Delete "${label}"?\n\nThis task is running and will be stopped.\n\nThis can't be undone.`
      : `Delete "${label}"? This can't be undone.`;
    if (!(await confirm({ title: "Delete task", message }))) return;
    setError("");
    setBusy(true);
    try {
      const res = await deleteTaskAction(task.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/tasks");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      {dialog}
      <button className="btn small danger" onClick={remove} disabled={busy}>
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Render it in the page header**

In `app/tasks/[id]/page.tsx`, add the import after the existing imports (after line 8):

```tsx
import { DeleteTaskButton } from "./delete-task-button";
```

Replace the header's right-hand badge block. Change (the `page-head` return, ~lines 27-38):

```tsx
        <span className={`badge ${task.status}`}>{task.status}</span>
      </div>
```

to:

```tsx
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className={`badge ${task.status}`}>{task.status}</span>
          <DeleteTaskButton
            task={task}
            label={taskLabel(prefix, task.id, task.title)}
          />
        </div>
      </div>
```

(`taskLabel` and `prefix` are already imported/computed in this file.)

- [ ] **Step 3: Verify typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: both succeed.

- [ ] **Step 4: Full test + build gate**

Run: `bun test && bun run typecheck && bun run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/tasks/[id]/delete-task-button.tsx app/tasks/[id]/page.tsx
git commit -m "feat: delete button on task detail page"
```

- [ ] **Step 6: Update the knowledge graph**

Run: `graphify update .`

---

## Self-Review

**Spec coverage:**
- Data layer `deleteTask` → Task 1. ✓
- `deleteTaskAction` + running-task `stop()` → Task 2. ✓
- Confirm message (plain + running variant) → Tasks 3 & 4 (inline, per spec — task deletion skips `deleteConfirmMessage`). ✓
- Kanban card UI → Task 3. ✓
- Detail-page UI (dedicated client component per updated spec) → Task 4. ✓
- Testing (repo cascade; action stop-before-delete; no orphan runs) → Tasks 1 & 2. ✓
- Out of scope (bulk, undo) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `deleteTask(db, id): void`, `deleteTaskAction(id): Promise<DeleteResult>`, `latestRunForTask(db, taskId): Run | null`, `stop(runId): void`, `register`/`isAborted` from registry, `TaskCard` `onDelete: () => void`, `DeleteTaskButton({ task, label })` — consistent across tasks. ✓
