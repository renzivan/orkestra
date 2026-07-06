# Task and reply attachments

Date: 2026-07-06

## Problem

A task's input, and a reply to a running/finished run, are plain text only.
Users cannot attach an image, screenshot, PDF, log, or any other file, so the underlying model never sees them.
We want a user to drop files onto the task-create form or the reply box and have the agent read those files.

## Constraint that shapes everything

Orkestra runs an agent by spawning a local CLI and piping the step's input to its **stdin** (`lib/engine/exec.ts`).
The `claude` adapter preset carries no image/file argument — input is text only, and the CLI reads local files by **path** (permission granted via `--add-dir`, filled from the agent's project paths through the `{projects:--add-dir}` placeholder in `lib/engine/template.ts`).

Therefore the only mechanism the architecture allows is:

1. Save each uploaded file to disk.
2. Inject the file's **absolute path** into the step's input text.
3. Expose the file's containing directory to the CLI so it is permitted to read it.

This is adapter-agnostic — any CLI that can read a local file works.
No adapter preset change and no new template placeholder are required.

## Decisions (locked during brainstorming)

- **File types:** any file. The picker does not restrict; the CLI reads whatever it can.
- **Flow scope:** first agent only. Paths are injected into the *initial* input; downstream steps chain output→input as they do today.
- **Storage location:** under `~/.orkestra/` (alongside the SQLite db), never inside a project dir.
- **Upload UX:** drag-and-drop only. No file-picker button, no clipboard paste.
- **Display:** filename chips with a remove control. No image thumbnails.
- **Size cap:** none. This is a local single-user app; files go straight to disk.

## Storage

### Disk

Per-task directory: `~/.orkestra/attachments/<taskId>/`.
Both task-body attachments and reply attachments for that task land in this one directory.
A reply resumes the same task's run, so a task-scoped directory covers both surfaces and keeps read-exposure to a single directory.

Filename collisions are de-duplicated on write: `log.txt`, then `log-2.txt`, `log-3.txt`.

The base path derives from the same root the db uses (honor `ORKESTRA_DB`'s directory / the `~/.orkestra` default), so tests can point it at a temp dir.

### Database

New `attachments` table (appended as a new `MIGRATIONS` entry — never edit a shipped version in place):

```
attachments
  id            INTEGER PRIMARY KEY
  task_id       INTEGER NOT NULL  -- REFERENCES tasks(id) ON DELETE CASCADE
  run_step_id   INTEGER           -- NULL = task-body attachment; set = reply attachment
  space_id      INTEGER NOT NULL  -- mirrors the owning task's space, for scoped listing
  filename      TEXT NOT NULL     -- de-duplicated on-disk name, also the display name
  disk_path     TEXT NOT NULL     -- absolute path, what gets injected + exposed
  mime          TEXT              -- best-effort from the upload; nullable
  size          INTEGER NOT NULL  -- bytes
  created_at    TEXT NOT NULL
```

`run_step_id` is nullable and distinguishes the two surfaces:
NULL means the file was attached to the task body (used by the first step of a fresh run);
a set value means it was attached to a specific reply step.

Cascade on `task_id` so deleting a task removes its attachment rows.
The on-disk directory is removed alongside the task in the same delete path that already cleans a task up.

## New unit: attachments repo

`lib/repos/attachments.ts`, following the existing repo pattern (plain functions over `Database`, no ORM):

- `createAttachment(db, input): Attachment` — inserts a row (path/name/mime/size already resolved by the caller that wrote the file).
- `listTaskBodyAttachments(db, taskId): Attachment[]` — `run_step_id IS NULL`.
- `listStepAttachments(db, stepId): Attachment[]` — for a given reply step.
- `getAttachment(db, id): Attachment | null`.
- `deleteAttachment(db, id): void` — row only; the disk file is removed by the action layer.

`Attachment` is added to `lib/types.ts`.

## New unit: attachment input builder (pure, testable)

`lib/engine/attachments.ts` — a pure function with no db or fs:

```ts
export function withAttachments(
  text: string,
  paths: string[],
): { input: string; dirs: string[] }
```

- Returns `text` unchanged and `dirs: []` when `paths` is empty.
- Otherwise appends a delimited block and returns the unique parent directories to expose:

```
<original text>

---
Attached files (read as needed):
- /Users/you/.orkestra/attachments/42/screenshot.png
- /Users/you/.orkestra/attachments/42/error.log
```

`dirs` is the de-duplicated set of parent directories of `paths` (here, the single per-task dir).
This function is the whole of the read mechanism and is unit-tested in isolation.

## Wiring into the runner

Two injection points, both naturally first-step-only:

1. **Fresh task run.** Where the runner assembles the seed input from `task.body`, call `withAttachments(task.body, taskBodyPaths)`.
   The augmented text becomes `seedInput`; `dirs` is passed to the first step.
   Because `runFrom` reassigns `input = step.output` after the first agent, later agents never see the block — first-agent-only falls out for free.

2. **Reply.** In `replyToRun`, call `withAttachments(reply, replyStepPaths)` and pass its `dirs` to the reply's `executeStep`.

`executeStep` gains an optional `extraDirs?: string[]` in its `opts`, appended to `projects` before `buildArgv`:

```ts
projects: [...agent.projects.map((p) => p.path), ...(opts.extraDirs ?? [])]
```

Only the first step of a fresh run and the reply step pass `extraDirs`; every other step passes nothing, so the attachment dir is exposed exactly where a file path was injected.

A resume does **not** re-inject: its step input is preserved from before, so it already contains the block from its original run.

## Server actions

In `app/actions.ts`:

- `uploadAttachmentAction(taskId, runStepId | null, file)` — writes the file to the per-task dir (de-duplicating the name), inserts the row via the repo, returns the created `Attachment` (so the client can render a chip). Resolves `space_id` from the owning task.
- `deleteAttachmentAction(id)` — deletes the disk file and the row; used by the chip's remove control before a run.

Files upload immediately on drop (not deferred to task submit), so an attachment always has a `task_id` to hang off.
This means the task-create form must create (or already have) the task row before files can attach.
The create form already persists a task on submit; to attach on drop we create the task row first (draft), then attach — or, if that reshapes the create flow too much, the plan may instead buffer dropped files client-side and upload them in the create action. **The plan step must pick one; this spec's default is: create the task row first, then attach on drop.**

## UI

- **Task-create form** and **reply box**: a drag-and-drop zone.
  Dropping files calls `uploadAttachmentAction` per file and renders a filename chip on success (toast on failure, matching the app's existing success/failure toasts).
- **Chips**: filename + size, with a remove (×) that calls `deleteAttachmentAction`.
  No image thumbnails.
- **Task detail / run view**: the task's body attachments and each reply step's attachments render as read-only chips, so a user can see what was sent with each input.

## Error handling

- A failed disk write or db insert surfaces as a failure toast; no chip appears; nothing is injected.
- Removing a chip that is already gone is a no-op.
- If a file row exists but its disk file is missing at run time, the path is still injected; the CLI simply fails to read it. We do not pre-validate existence in the hot path.

## Testing

- **`withAttachments`** (pure): empty paths → unchanged text + no dirs; one path → block appended + one parent dir; multiple paths sharing a dir → de-duplicated dirs.
- **attachments repo** against a real sqlite db (existing pattern in `test/repos/`): create, list-by-task-body vs list-by-step, delete, cascade on task delete.
- **runner**: a fresh run with a task-body attachment exposes the per-task dir on the first step only and not on later steps; a reply with an attachment exposes it on the reply step.
- Existing engine tests (fake CLI) continue to pass.

## Out of scope

- Native multimodal / image content blocks (the CLI does not support it via stdin).
- Attachments visible to downstream flow agents.
- Clipboard paste and a file-picker button.
- Image thumbnails and in-app preview.
- Any size limit or type restriction.
```
