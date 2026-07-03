# Pause/Resume + Stop/Re-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single muddy "Stop" action into two clean pairs — **Pause → Resume** (warm, `--resume`) and **Stop → Re-run** (cold, fresh run) — backed by a new `paused` status.

**Architecture:** Both Pause and Stop SIGTERM the running CLI; they differ only in the recorded status and the single forward action offered afterward. The registry records a pause-vs-stop *intent*; the runner's winddown reads it to land the run/task/interrupted-step in `paused` or `stopped`. `paused` reuses the existing `resumeRun` continuation mechanism; `stopped` reuses the existing fresh-run `runTask` path. No new halt mechanism, no deletion.

**Tech Stack:** Bun, `bun:sqlite`, Next 16 App Router, React 19. Tests: `bun test` with fake CLI fixtures under `test/fixtures/`.

## Global Constraints

- Runtime is Bun. Run tests with `bun test`; the type gate is `bun run typecheck` (must pass).
- Follow `docs/CONVENTIONS.md`: repos take `db` first and own all SQL; the engine composes repos and owns no SQL; the UI never calls `db()`/repos for writes — writes go through `app/actions.ts`. Results that can fail are discriminated unions. Dense "why" comments. 2-space indent, double quotes, trailing commas, semicolons.
- Statuses live behind a SQLite `CHECK` constraint; adding one requires a table-rebuild migration (SQLite can't alter a CHECK in place).
- Domain terms: a **run** has ordered **steps**; a **task** targets an **agent** or **flow**. Use these words.
- After code changes, keep the graph current: `graphify update .`.
- Do not add an agent co-author trailer to commits.

---

### Task 1: Add the `paused` status (types + migration)

**Files:**
- Modify: `lib/types.ts:52-59` (TaskStatus + RunStatus unions)
- Modify: `lib/db/migrations.ts` (append migration v11 at the end of the `MIGRATIONS` array)
- Test: `test/db/migrations.test.ts` (create if absent) and `test/repos/tasks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TaskStatus` and `RunStatus` both include `"paused"`; the DB accepts `status = 'paused'` on `tasks`, `runs`, `run_steps`.

- [ ] **Step 1: Write the failing test**

Add to `test/db/migrations.test.ts` (create the file if it does not exist; mirror the imports of other `test/` files):

```ts
import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";

test("v11 lets tasks, runs and run_steps hold a 'paused' status", () => {
  const db = openDb(":memory:");
  // The CHECK constraints must accept 'paused' on all three tables.
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO tasks (title, body, target_type, target_id, status, created_at, updated_at)
     VALUES ('T', '', 'agent', 1, 'paused', $n, $n)`,
  ).run({ $n: now });
  const task = db.query("SELECT id FROM tasks WHERE status='paused'").get() as {
    id: number;
  };
  expect(task).not.toBeNull();

  db.query(
    `INSERT INTO runs (task_id, status, started_at) VALUES ($t, 'paused', $n)`,
  ).run({ $t: task.id, $n: now });
  const run = db.query("SELECT id FROM runs WHERE status='paused'").get() as {
    id: number;
  };
  expect(run).not.toBeNull();

  db.query(
    `INSERT INTO run_steps (run_id, position, agent_id, agent_name, status, started_at)
     VALUES ($r, 0, 1, 'a', 'paused', $n)`,
  ).run({ $r: run.id, $n: now });
  const step = db
    .query("SELECT id FROM run_steps WHERE status='paused'")
    .get();
  expect(step).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/db/migrations.test.ts`
Expected: FAIL — the insert throws `CHECK constraint failed` for `paused`.

- [ ] **Step 3: Extend the status unions**

In `lib/types.ts`, add `"paused"` to both unions. TaskStatus (currently ending `| "stopped";`) becomes:

```ts
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "paused";
export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "paused";
```

- [ ] **Step 4: Append migration v11**

At the very end of the `MIGRATIONS` array in `lib/db/migrations.ts` (after the v10 entry), add a new element. It rebuilds all three tables in place — same technique as v6 — with `paused` added to each CHECK. The `tasks_new` column list ends with `settled_at TEXT, seen_at TEXT` to match the live column order (v10 added those), so `SELECT *` copies line up.

```ts
  // v11 — add a 'paused' status (a resumable rest state: user halted the run but
  // intends to continue it via --resume, distinct from a terminal 'stopped').
  // SQLite can't alter a CHECK, so each table is rebuilt in place exactly as v6
  // did. Column order in tasks_new mirrors the live table (v10's settled_at,
  // seen_at trail the original columns) so `INSERT ... SELECT *` aligns.
  [
    `PRAGMA foreign_keys=OFF`,

    `CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL CHECK (target_type IN ('flow','agent')),
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','succeeded','failed','stopped','paused')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT,
      seen_at TEXT
    )`,
    `INSERT INTO tasks_new SELECT * FROM tasks`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`,

    `CREATE TABLE runs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','stopped','paused')),
      final_output TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    )`,
    `INSERT INTO runs_new SELECT * FROM runs`,
    `DROP TABLE runs`,
    `ALTER TABLE runs_new RENAME TO runs`,

    `CREATE TABLE run_steps_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      exit_code INTEGER,
      error TEXT,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','stopped','paused')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      transcript TEXT NOT NULL DEFAULT '[]',
      session_id TEXT
    )`,
    `INSERT INTO run_steps_new SELECT * FROM run_steps`,
    `DROP TABLE run_steps`,
    `ALTER TABLE run_steps_new RENAME TO run_steps`,

    `PRAGMA foreign_keys=ON`,
  ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/db/migrations.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/db/migrations.ts test/db/migrations.test.ts
git commit -m "feat: add 'paused' run/task status (migration v11)"
```

---

### Task 2: `paused` is silent for the unread badge

**Files:**
- Modify: none expected — verify the default is already correct.
- Test: `test/repos/tasks.test.ts`

**Interfaces:**
- Consumes: `TaskStatus` includes `"paused"` (Task 1).
- Produces: confirmed invariant — `setTaskStatus(db, id, "paused")` leaves `settled_at` null; `countUnreadTasks` ignores paused.

Context: `lib/repos/tasks.ts` has `const TERMINAL: TaskStatus[] = ["succeeded", "failed", "stopped"]`. Only statuses in `TERMINAL` stamp `settled_at`. `countUnreadTasks`/`isTaskUnread` count only `succeeded`/`failed`. So leaving `paused` **out** of `TERMINAL` (the default) already makes it silent. This task locks that in with a test.

- [ ] **Step 1: Write the failing-then-passing guard test**

Add to `test/repos/tasks.test.ts`:

```ts
test("pausing a task does not stamp settled_at or count as unread", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: 1,
  });
  Tasks.setTaskStatus(db, t.id, "paused");
  const paused = Tasks.getTask(db, t.id)!;
  expect(paused.status).toBe("paused");
  expect(paused.settled_at).toBeNull(); // silent: no settle stamp
  expect(Tasks.isTaskUnread(paused)).toBe(false);
  expect(Tasks.countUnreadTasks(db)).toBe(0);
});
```

(Match the existing import style at the top of `test/repos/tasks.test.ts` — it already imports `openDb` and `* as Tasks`.)

- [ ] **Step 2: Run the test**

Run: `bun test test/repos/tasks.test.ts`
Expected: PASS immediately (default behavior). If it FAILS because `paused` was added to `TERMINAL`, remove it — `paused` must not be terminal.

- [ ] **Step 3: Commit**

```bash
git add test/repos/tasks.test.ts
git commit -m "test: lock in paused being silent for the unread badge"
```

---

### Task 3: Registry — record pause-vs-stop intent

**Files:**
- Modify: `lib/engine/registry.ts`
- Test: `test/engine/registry.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pause(runId: number): void` — flags aborted with intent `"pause"`, kills the proc.
  - `stop(runId: number): void` — flags aborted with intent `"stop"`, kills the proc.
  - `abortIntent(runId: number): "pause" | "stop" | null` — the recorded intent (null if not aborted / unknown run).
  - `isAborted(runId)` unchanged (true for either intent).
  - `register(runId)` resets intent to `null`.

- [ ] **Step 1: Write the failing test**

Create `test/engine/registry.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  register,
  pause,
  stop,
  isAborted,
  abortIntent,
  unregister,
} from "../../lib/engine/registry";

test("pause and stop record distinct intents; register resets", () => {
  register(1);
  expect(isAborted(1)).toBe(false);
  expect(abortIntent(1)).toBeNull();

  pause(1);
  expect(isAborted(1)).toBe(true);
  expect(abortIntent(1)).toBe("pause");

  register(2);
  stop(2);
  expect(isAborted(2)).toBe(true);
  expect(abortIntent(2)).toBe("stop");

  // Reusing a run id (a resume re-registers) clears the prior intent.
  register(1);
  expect(isAborted(1)).toBe(false);
  expect(abortIntent(1)).toBeNull();

  unregister(1);
  unregister(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/engine/registry.test.ts`
Expected: FAIL — `pause` and `abortIntent` are not exported.

- [ ] **Step 3: Implement the intent in the registry**

In `lib/engine/registry.ts`, extend the handle and add the functions. Replace the `RunHandle` interface, the `register` and `stop` functions, and add `pause` + `abortIntent`:

```ts
interface RunHandle {
  proc: Subprocess | null;
  aborted: boolean;
  // Why the run was aborted: 'pause' winds it down to a resumable 'paused'
  // state, 'stop' to a terminal 'stopped'. null until a halt is requested.
  intent: "pause" | "stop" | null;
}
```

```ts
/** Begin tracking a run. Resets state, so resuming can reuse the same run id. */
export function register(runId: number): void {
  runs.set(runId, { proc: null, aborted: false, intent: null });
}
```

Replace the single `stop` with an intent-setting helper plus the two public verbs:

```ts
/** Shared halt: flag the run aborted with an intent and kill its live process.
 *  SIGTERM lets the CLI exit; the runner treats the killed step per the intent. */
function halt(runId: number, intent: "pause" | "stop"): void {
  const h = runs.get(runId);
  if (!h) return;
  h.aborted = true;
  h.intent = intent;
  h.proc?.kill();
}

/** Pause a run: halt now, keep it resumable (--resume continues its session). */
export function pause(runId: number): void {
  halt(runId, "pause");
}

/** Stop a run: halt now, terminally. The run stays as history; Re-run starts fresh. */
export function stop(runId: number): void {
  halt(runId, "stop");
}

/** The recorded halt intent, or null if the run wasn't halted / isn't tracked. */
export function abortIntent(runId: number): "pause" | "stop" | null {
  return runs.get(runId)?.intent ?? null;
}
```

Leave `isAborted`, `setProc`, `clearProc`, `unregister` as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/engine/registry.test.ts && bun run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/registry.ts test/engine/registry.test.ts
git commit -m "feat: registry records pause vs stop halt intent"
```

---

### Task 4: Runner — wind down by intent (paused vs stopped)

**Files:**
- Modify: `lib/engine/runner.ts` (import `abortIntent`; `stopRun`; the abort branch in `executeStep`)
- Test: `test/engine/stop-resume.test.ts`, `test/engine/runner.test.ts`

**Interfaces:**
- Consumes: `abortIntent(runId)` (Task 3).
- Produces: a paused halt lands run/task/interrupted-step in `paused`; a stop halt lands them in `stopped`. `resumeRun` (already implemented) continues from a `paused` step unchanged.

- [ ] **Step 1: Write the failing tests**

In `test/engine/stop-resume.test.ts`, add `pause` to the registry import:

```ts
import { stop, pause } from "../../lib/engine/registry";
```

Add two tests that drive a real halt of a sleeping step (mirror the existing "stopping a running task marks it stopped" test, which uses `sleep-model.sh` + `waitFor`):

```ts
test("pausing a running task winds the run down to 'paused'", async () => {
  const db = openDb(":memory:");
  const counter = join(tmpdir(), `ork-pause-${process.pid}-${Date.now()}`);
  if (existsSync(counter)) rmSync(counter);

  const sleepy = Adapters.createAdapter(db, {
    name: "sleep",
    command: `bash test/fixtures/sleep-model.sh ${counter}`,
  });
  const a = agent(db, "blocker", sleepy.id);
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  const p = runTask(db, t.id); // don't await — blocks in the sleeping step
  const run = Runs.latestRunForTask(db, t.id)!;
  await waitFor(() => existsSync(counter));

  pause(run.id);
  const finished = await p;

  expect(finished.status).toBe("paused");
  expect(Tasks.getTask(db, t.id)!.status).toBe("paused");
  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.steps[0].status).toBe("paused"); // interrupted step is resumable
  rmSync(counter);
});

test("stopping a running task winds the run down to 'stopped'", async () => {
  const db = openDb(":memory:");
  const counter = join(tmpdir(), `ork-stopd-${process.pid}-${Date.now()}`);
  if (existsSync(counter)) rmSync(counter);

  const sleepy = Adapters.createAdapter(db, {
    name: "sleep",
    command: `bash test/fixtures/sleep-model.sh ${counter}`,
  });
  const a = agent(db, "blocker", sleepy.id);
  const t = Tasks.createTask(db, {
    title: "T",
    body: "hi",
    target_type: "agent",
    target_id: a.id,
  });

  const p = runTask(db, t.id);
  const run = Runs.latestRunForTask(db, t.id)!;
  await waitFor(() => existsSync(counter));

  stop(run.id);
  const finished = await p;

  expect(finished.status).toBe("stopped");
  expect(Tasks.getTask(db, t.id)!.status).toBe("stopped");
  expect(Runs.getRunWithSteps(db, run.id).steps[0].status).toBe("stopped");
  rmSync(counter);
});
```

Also update the two existing resume tests in `test/engine/stop-resume.test.ts` that seed a `stopped` step to represent a *pause*: change the seeded interrupted-step status from `'stopped'` to `'paused'` and the run status to `'paused'` (these tests assert resume keeps the step and appends a continuation — the mechanism is unchanged, only the resting status differs). Concretely, in "resume keeps the interrupted step and appends its continuation" and "resume of a single-agent task keeps step 0 and continues from the task body", change:

```ts
db.query("UPDATE runs SET status='stopped', finished_at=$n WHERE id=$id")
```
to `status='paused'`, and
```ts
db.query("UPDATE run_steps SET status='stopped' WHERE run_id=$r AND position=1")
```
to `status='paused'` (and the position=0 variant likewise), and `Tasks.setTaskStatus(db, t.id, "stopped")` to `"paused"`. Update the assertion `expect(full.steps[1].status).toBe("stopped")` / `steps[0].status` to `"paused"`.

Likewise in `test/engine/runner.test.ts`, the `seedStoppedRun` helper and its callers assert `status: "stopped"` on the interrupted step; rename to `seedPausedRun` and set `status: "paused"`, updating the two assertions `expect(full.steps[0].status).toBe("stopped")` to `"paused"`. (The `--resume` continuation assertions stay identical.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test test/engine/stop-resume.test.ts`
Expected: FAIL — the pause test sees `stopped` (runner still hardcodes it); the edited resume tests fail because the interrupted step is `paused` but the winddown/step still writes `stopped`.

- [ ] **Step 3: Import `abortIntent` in the runner**

In `lib/engine/runner.ts`, add `abortIntent` to the registry import:

```ts
import {
  register,
  unregister,
  setProc,
  clearProc,
  isAborted,
  abortIntent,
} from "./registry";
```

- [ ] **Step 4: Wind down by intent in `stopRun`**

Replace the `stopRun` helper so it derives the terminal status from the intent (default `stopped` if somehow unset):

```ts
/** Wind a run down after a user halt: mark the run and task paused or stopped to
 *  match the halt intent. The interrupted step (if one was mid-flight) was
 *  already marked to match by executeStep; a halt between steps leaves earlier
 *  steps intact. */
function stopRun(
  db: Database,
  runId: number,
  taskId: number,
): Runs.RunWithSteps {
  const status = abortIntent(runId) === "pause" ? "paused" : "stopped";
  Runs.finishRun(db, runId, { status, final_output: null, error: null });
  setTaskStatus(db, taskId, status);
  publish(runId, { type: "done", status });
  return Runs.getRunWithSteps(db, runId);
}
```

- [ ] **Step 5: Mark the interrupted step to match intent**

In `executeStep`, the abort branch currently writes `status: "stopped"` twice (the `finishRunStep` call and the `step_done` publish). Derive it from intent:

```ts
  // A user halt killed the process — record the step as paused or stopped (not
  // failed) per the halt intent, and let the caller wind the run down. The abort
  // flag, not the exit code, is the source of truth: a killed CLI exits non-zero
  // but that isn't a failure.
  if (isAborted(runId)) {
    const status = abortIntent(runId) === "pause" ? "paused" : "stopped";
    Runs.finishRunStep(db, stepId, {
      output: result.stdout,
      exit_code: result.exitCode,
      error: null,
      status,
    });
    publish(runId, {
      type: "step_done",
      position: pos,
      status,
      exit_code: result.exitCode,
    });
    return { ok: false, stopped: true };
  }
```

- [ ] **Step 6: Run the whole engine suite**

Run: `bun test test/engine && bun run typecheck`
Expected: PASS (new pause/stop winddown tests, edited resume tests, existing stop test all green); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/runner.ts test/engine/stop-resume.test.ts test/engine/runner.test.ts
git commit -m "feat: runner winds a halted run down to paused or stopped by intent"
```

---

### Task 5: Server actions — pause vs stop

**Files:**
- Modify: `app/actions.ts` (import `pause`; add `pauseRunAction`; keep `stopRunAction` as terminal stop)
- Test: `test/engine/stop-resume.test.ts` (action-level assertions optional; the registry/runner tests already cover winddown)

**Interfaces:**
- Consumes: `pause`, `stop` from `lib/engine/registry` (Task 3).
- Produces:
  - `pauseRunAction(runId: number): Promise<{ ok: true }>` — pauses the live run.
  - `stopRunAction(runId: number): Promise<{ ok: true }>` — stops the live run terminally (unchanged signature; now calls the terminal `stop`).

- [ ] **Step 1: Import `pause`**

In `app/actions.ts`, extend the registry import:

```ts
import { stop, pause } from "@/lib/engine/registry";
```

- [ ] **Step 2: Add `pauseRunAction` and clarify `stopRunAction`**

Replace the existing `stopRunAction` block (the doc comment + function) with both actions:

```ts
/** Pause a running run: halt it now but keep it resumable. The runner transitions
 *  the run/task to 'paused', preserves the interrupted step + its session, and
 *  publishes the terminal event; Resume continues it with --resume. */
export async function pauseRunAction(runId: number): Promise<{ ok: true }> {
  pause(runId);
  revalidate("/tasks");
  return { ok: true };
}

/** Stop a running run terminally: flag it aborted and kill its live process. The
 *  runner transitions the run/task to 'stopped'; the run stays as history and
 *  only Re-run (a fresh run) is offered. */
export async function stopRunAction(runId: number): Promise<{ ok: true }> {
  stop(runId);
  revalidate("/tasks");
  return { ok: true };
}
```

Leave the task-deletion cleanup that calls `stop(latest.id)` as-is (terminal kill of an orphaned run is correct).

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean (no callers broken; `stopRunAction` signature unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts
git commit -m "feat: pauseRunAction (resumable) alongside terminal stopRunAction"
```

---

### Task 6: UI — Pause/Stop controls, paused badge, continuation

**Files:**
- Modify: `app/tasks/[id]/run-view.tsx`
- Modify: `app/globals.css` (add `.badge.paused`)

**Interfaces:**
- Consumes: `pauseRunAction`, `stopRunAction`, `resumeRunAction`, `runTaskAction` (Task 5 + existing).
- Produces: UI states — running → `[Pause] [Stop]`; `paused` → `[Resume]`; `stopped` → `[Re-run]`.

- [ ] **Step 1: Import the pause action**

In `app/tasks/[id]/run-view.tsx`, add `pauseRunAction` to the actions import:

```ts
import {
  runTaskAction,
  replyToRunAction,
  stopRunAction,
  pauseRunAction,
  resumeRunAction,
  markTaskSeenAction,
} from "../../actions";
```

- [ ] **Step 2: Add a `pausing` flag beside `stopping`**

Below the existing `const [stopping, setStopping] = useState(false);`:

```ts
  // Pause has its own pending flag, like stop: it stays "Pausing…" until the run
  // winds down to 'paused', so the button doesn't flicker back to enabled.
  const [pausing, setPausing] = useState(false);
```

Extend the effect that clears `stopping` when the run leaves 'running' to clear `pausing` too:

```ts
  useEffect(() => {
    if (!streaming) {
      setStopping(false);
      setPausing(false);
    }
  }, [streaming]);
```

- [ ] **Step 3: Add `pause()` and rename the terminal handler**

Add a `pause` handler mirroring `stopRun`, and keep `stopRun` calling `stopRunAction`:

```ts
  async function pauseRun() {
    if (!initialRun) return;
    setPausing(true);
    // Stays disabled until the SSE 'done' flips the view to paused (see the
    // effect above); only clear early if the request itself fails.
    try {
      await pauseRunAction(initialRun.id);
    } catch {
      setPausing(false);
    }
  }
```

(`stopRun` already exists and calls `stopRunAction`; leave its body, it now means terminal stop.)

- [ ] **Step 4: Rework the controls block**

Replace the header controls JSX (the `{streaming ? ... : runStatus === "stopped" ? ... : ...}` block) with Pause+Stop while running, Resume-only for paused, Re-run-only for stopped:

```tsx
        {streaming ? (
          <div className="row">
            <button className="btn" onClick={pauseRun} disabled={pausing}>
              {pausing ? "Pausing…" : "Pause"}
            </button>
            <button
              className="btn danger"
              onClick={stopRun}
              disabled={stopping}
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </div>
        ) : runStatus === "paused" ? (
          <button
            className="btn primary"
            onClick={resume}
            disabled={busy || blocked}
            title={blocked ? runnable.reason : undefined}
          >
            Resume
          </button>
        ) : runStatus === "stopped" ? (
          <button
            className="btn"
            onClick={run}
            disabled={busy || blocked}
            title={blocked ? runnable.reason : undefined}
          >
            Re-run
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={run}
            disabled={busy || blocked}
            title={blocked ? runnable.reason : undefined}
          >
            {runStatus ? "Re-run" : "Run"}
          </button>
        )}
```

- [ ] **Step 5: Key the continuation-bubble suppression on `paused`**

The resume continuation now follows a **paused** step. Update the `isResumeContinuation` check:

```tsx
        const isResumeContinuation =
          prev != null && prev.status === "paused" && s.input === prev.input;
```

- [ ] **Step 6: Show a per-step "paused" note**

Beside the existing stopped note, add a paused one:

```tsx
              {s.status === "paused" && (
                <div className="muted mono stopped-note">paused</div>
              )}
              {s.status === "stopped" && (
                <div className="muted mono stopped-note">stopped</div>
              )}
```

- [ ] **Step 7: Add the paused badge style**

In `app/globals.css`, after `.badge.stopped { ... }`, add:

```css
.badge.paused {
  color: var(--info);
  background: #eef1f6;
  border-color: color-mix(in srgb, var(--info) 25%, var(--line));
}
```

- [ ] **Step 8: Typecheck + manual E2E**

Run: `bun run typecheck`
Expected: clean.

Manual E2E (no automated UI test — this is view logic; conventions test the engine): start the app (`bun --bun run dev`), run a task, and verify:
1. While running, both **Pause** and **Stop** show.
2. **Pause** → badge `paused`, only **Resume** shows, prior transcript stays; Resume appends a continuation with no duplicate user bubble.
3. **Stop** → badge `stopped`, only **Re-run** shows; Re-run starts a fresh run.
4. The sidebar unread badge does **not** increment on pause.

- [ ] **Step 9: Commit**

```bash
git add "app/tasks/[id]/run-view.tsx" app/globals.css
git commit -m "feat: Pause/Stop controls with paused status, Resume/Re-run pairing"
```

---

### Task 7: Refresh the knowledge graph

**Files:** none (regenerates `graphify-out/`, which is gitignored).

- [ ] **Step 1: Update the graph**

Run: `graphify update .`
Expected: "Code graph updated."

- [ ] **Step 2: Final full check**

Run: `bun test && bun run typecheck`
Expected: all green; typecheck clean.

---

## Self-Review

**Spec coverage:**
- Status model / `paused` added → Task 1. ✔
- Terminal/settled classification (paused silent) → Task 2. ✔
- Migration v11 (3-table rebuild, v6 pattern, v10 column order) → Task 1. ✔
- Registry pause/stop intent → Task 3. ✔
- Runner winddown by intent + step status → Task 4. ✔
- `resumeRun` fires from paused (mechanism unchanged) → covered by edited resume tests in Task 4. ✔
- Re-run unchanged (fresh run) → existing `runTask`; asserted implicitly by Task 6 manual E2E and existing tests. ✔
- Server actions pause/stop → Task 5. ✔
- UI controls / badge / per-step note / continuation key / pausing flag → Task 6. ✔
- Unread badge unaffected by paused → Task 2. ✔
- Tests enumerated (1 pause→resume, 2 stop terminal, 3 intent routing, 4 no-retry, 5 migration, 6 unread) → Tasks 1–4 cover 1/3/5/6; no-retry (4) is already covered by the existing "does not retry" test which is intent-agnostic; stop-terminal Re-run-produces-new-run (2) is verified via Task 6 manual E2E plus the existing runner two-agent/single-agent tests that exercise `runTask` fresh runs. ✔

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. ✔

**Type consistency:** `pause`/`stop`/`abortIntent` names consistent across Tasks 3–5; `pauseRunAction`/`stopRunAction` consistent Tasks 5–6; status literal `"paused"` consistent across all tasks; `isResumeContinuation` keyed on `"paused"` consistent with Task 4's step status. ✔
