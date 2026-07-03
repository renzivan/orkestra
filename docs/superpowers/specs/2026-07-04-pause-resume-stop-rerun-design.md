# Pause/Resume + Stop/Re-run — Design

Date: 2026-07-04
Status: approved (pre-implementation)

## Problem

A running task can only be **Stopped**.
A stopped run then shows both **Re-run** and **Resume**, which is confusing: two buttons that read as the same action, with no signal of which continues prior work and which starts over.

Under the current fix, Stop already does the right *mechanism* for continuing: it SIGTERMs the process, preserves the interrupted step (transcript + captured `session_id`), and Resume continues that CLI session with `--resume`.
The mechanism is fine; the vocabulary and pairing are wrong.

## Goal

Split one muddy action into two clean pairs:

- **Pause → Resume** — halt now, continue later from where it left off (warm, `--resume`).
- **Stop → Re-run** — end this attempt, start over from scratch (cold, fresh run).

The user picks intent at halt time. Each resting state offers exactly one forward action.

## Key insight

Today's **Stop** behavior *is* Pause behavior. The redesign is mostly rename + split, not a new mechanism:

| Today | Becomes |
| --- | --- |
| Stop → status `stopped` → [Re-run] + [Resume] | **Pause** → status `paused` → [Resume] |
| — | **Stop** (new) → status `stopped` → [Re-run] |

Both Pause and Stop physically SIGTERM the process — there is no way to halt a running CLI without killing it, and a true process freeze (SIGSTOP) is rejected: a frozen process drops its model-provider stream and does not survive an app restart or crash.
So Pause and Stop differ **only** in the recorded status and the single forward action offered afterward. Same kill, different label.

Stop does **not** delete anything: the run's steps remain as read-only history so the user can read what happened. It simply never offers to continue and ignores the captured session.

## Status model

Add a new status `paused` (a resumable resting state). `stopped` stays (terminal).

- `paused` is **not** terminal — a paused run is expected to be resumed.
- `stopped` is terminal for continuation purposes, but Re-run (a brand-new run) is always available.

### Terminal / settled classification

- **Settled (pings the sidebar unread badge, sets `settled_at`):** `succeeded`, `failed`, `stopped` — unchanged.
- **`paused` is silent:** the user paused deliberately and is present, so a paused run is a resting state they own, not a surprise result. `paused` does **not** set `settled_at` and is **not** counted toward the unread badge.
- **`running`** unchanged (not settled).

## Data / migration

`tasks`, `runs`, and `run_steps` each carry a `CHECK (status IN (...))` constraint.
SQLite cannot alter a CHECK in place, so add migration **v11** that rebuilds all three tables (create-new → copy → drop → rename), mirroring the v6 pattern that added `stopped`.

New CHECK sets:

- `tasks.status`: `pending, running, succeeded, failed, stopped, paused`
- `runs.status`: `running, succeeded, failed, stopped, paused`
- `run_steps.status`: `running, succeeded, failed, stopped, paused`

The rebuilt `tasks` table must declare columns in the live order, including the v10 trailing additions `settled_at TEXT, seen_at TEXT`, so `INSERT INTO tasks_new SELECT * FROM tasks` lines up.
Wrap the rebuild in `PRAGMA foreign_keys=OFF` / `ON` as v6 does.

`lib/types.ts`: extend `RunStatus` (and `TaskStatus` if separate) with `"paused"`.

## Registry — pause vs stop intent

`lib/engine/registry.ts` currently tracks `{ proc, aborted }` per run and exposes `stop(runId)` + `isAborted(runId)`.

Change:

- Record the abort **intent** on the handle: `abortIntent: "pause" | "stop" | null` (or reuse a small discriminated field).
- `pause(runId)` — set `abortIntent = "pause"`, kill the proc (SIGTERM).
- `stop(runId)` — set `abortIntent = "stop"`, kill the proc (SIGTERM).
- `isAborted(runId)` — true when `abortIntent != null` (unchanged polling semantics).
- Add `abortIntent(runId): "pause" | "stop" | null` so the runner can pick the terminal status.
- `register` resets `abortIntent` to `null` (so a reused run id starts clean).

## Runner

`lib/engine/runner.ts`:

- The winddown helper `stopRun(db, runId, taskId)` currently hardcodes run/task status `"stopped"`. Parameterize it to accept the terminal status derived from `abortIntent` (`paused` or `stopped`), and set the run and task to that status. Publish the terminal `done` event with that status.
- In `executeStep`, the abort branch currently marks the interrupted step `"stopped"`. Set it to `paused` or `stopped` according to intent, so a paused run's interrupted step is `paused` (and stays resumable) while a stopped run's is `stopped`.
- `resumeRun` is unchanged in mechanism. It fires from a `paused` run; its `findIndex(s.status !== "succeeded")` finds the paused interrupted step, keeps it, and appends a `--resume` continuation (existing behavior). Resuming a `stopped` run is not offered by the UI.
- `runTask` (Re-run path) unchanged: a fresh `startRun`, new run id, from scratch.

## Server actions

`app/actions.ts`:

- Add `pauseRunAction(runId)` — calls `pause(runId)` (registry). This is exactly today's `stopRunAction` behavior.
- `stopRunAction(runId)` — now calls `stop(runId)` (terminal intent).
- `resumeRunAction` / `runTaskAction` unchanged.

## UI — `app/tasks/[id]/run-view.tsx`

Controls by state:

- **running / streaming** → `[ Pause ]` and `[ Stop ]` (Pause primary, Stop danger). Each has its own pending-disabled flag (`pausing`, `stopping`) mirroring the existing `stopping` logic so the button reads "Pausing…" / "Stopping…" until the run winds down.
- **`paused`** → `[ Resume ]` only.
- **`stopped`** → `[ Re-run ]` only.
- **other terminal** (`succeeded`/`failed`) → unchanged (Re-run / Run).

Other UI:

- Badge: add a `paused` variant (CSS class `badge paused`).
- Per-step note: the existing `s.status === "stopped"` note gains a `paused` sibling ("paused").
- Resume-continuation bubble suppression currently keys on the preceding step being `stopped`; change it to `paused` (a continuation now follows a paused step, since pause is what preserves + resumes).
- `blocked` gating unchanged; Pause/Stop are never gated (they act on the live process).

## Testing

`bun test`, fake CLI fixtures. Cover:

1. **Pause → resume** — a paused run keeps its interrupted step and appends a `--resume` continuation (port the existing resume tests; the interrupted step's status is now `paused`).
2. **Stop → terminal** — a stopped run stays `stopped`; Re-run produces a **new** run (distinct run id) from the task body; the old run's steps remain intact as history.
3. **Intent routing** — pausing a running step winds the run down to `paused`; stopping winds it to `stopped` (assert run, task, and interrupted-step status for each).
4. **No retry on halt** — unchanged: neither pause nor stop retries the killed step.
5. **Migration** — `paused` is an accepted status on `tasks`/`runs`/`run_steps` after v11; existing rows survive the rebuild.
6. **Unread badge** — a `paused` run does not set `settled_at` / is not counted; `stopped` still does.

Update existing `stop-resume.test.ts` and `runner.test.ts` cases whose seeded/asserted status was `stopped`-for-resume to `paused`.

## Out of scope / deliberate choices

- **Strict pairing:** `paused` shows only Resume, `stopped` shows only Re-run. A paused run does not also offer Re-run, and a stopped run does not offer Resume. This is the whole point of the split; revisit only if it proves too rigid.
- **No true freeze (SIGSTOP).** Rejected as above.
- **No deletion on Stop.** History is preserved; Stop only changes label + available action.
- **Re-run semantics unchanged** — it already starts a fresh run.
