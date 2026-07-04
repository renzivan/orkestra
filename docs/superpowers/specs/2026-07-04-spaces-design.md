# Spaces — top-level isolation (Roadmap §1)

Design for the first Roadmap item.
Supersedes the roadmap's DB-per-file sketch: the owner chose a **single-DB, logical-isolation** model instead.

## Goal

One Orkestra install, several isolated **Spaces** (e.g. personal vs work).
Each Space has its own Projects, Tasks, Flows, Agents, Skills, and Settings.
Switching the active Space changes only what you *see*; anything running in another Space keeps running, because the engine reads rows by id and never consults the active Space.

## Term

**Space** — the isolation container that *holds* Projects.
`CONTEXT.md` already bans **Workspace** as a synonym for **Project**; that avoid-note stays.
`Space` is added to the `CONTEXT.md` Language section.

## Model — single DB, `space_id` scoping

One SQLite file as today (`~/.orkestra/orkestra.db`).
A Space is a row; top-level entities carry a `space_id`.

### Migration v11

Follows the established v6/v8 rebuild pattern (create-new → copy → drop → rename, FK enforcement off for the swap).

1. `CREATE TABLE spaces(id, name UNIQUE COLLATE NOCASE, created_at, updated_at)`; seed one row **"ETel"** (renameable) to hold all existing data.
2. Add `space_id NOT NULL REFERENCES spaces(id) ON DELETE CASCADE` to the five top-level tables: `skills`, `projects`, `agents`, `flows`, `tasks`. Backfill every existing row to `(SELECT MIN(id) FROM spaces)`.
3. `runs` / `run_steps` get **no** column — they inherit scope through the `tasks` FK cascade.
4. `adapters` stay **global** — they are detected from PATH, not authored, so they are naturally Space-independent (per roadmap).
5. Per-Space uniqueness: `UNIQUE(name)` → `UNIQUE(space_id, name)` on skills/projects/agents/flows. The same name can exist in two Spaces.
6. Per-Space default agent: rebuild the `agents_one_default` partial unique index as `ON agents(space_id) WHERE is_default = 1` — one Default agent per Space.
7. `settings` goes from a single row (`id = 1`) to one row per Space: `settings(space_id PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE, retries, step_timeout_seconds, task_prefix)`. The existing row is copied onto the seeded Space.

### Why per-Space Settings

The roadmap lists Settings among what a Space owns, and `task_prefix` is obviously per-Space (an "ENG" prefix belongs to work, not personal). `retries` / `step_timeout_seconds` come along so a Space is fully self-contained.

## Active Space — a cookie

The active Space is stored in a **cookie**, not the DB.
This keeps "active" a pure view concern with zero engine coupling, and switching never writes shared state.

- `getActiveSpaceId(db)` (app layer) reads the cookie, validates the Space still exists, and falls back to the earliest Space when absent/invalid.
- Switching is a server action: set the cookie, `revalidatePath("/", "layout")`.
- Running tasks are unaffected: the engine resolves everything by id.

Multi-tab divergent views are out of scope; all tabs share the one cookie.

## Repo changes

- Space-scoped **list / create / count** gain a `spaceId` parameter:
  `listTasks(db, spaceId)`, `listAgents(db, spaceId)`, `listFlows(db, spaceId)`, `listProjects(db, spaceId)`, `listSkills(db, spaceId)`, `countUnreadTasks(db, spaceId)`, `getDefaultAgent(db, spaceId)`, and `createSkill/Project/Agent/Flow/Task(db, spaceId, input)`.
- **Getters-by-id stay global** (`getTask(db, id)`, etc.). Ids are unique across Spaces; the UI only ever links within the active Space. A hand-crafted URL to another Space's id is **not** blocked — this is a guardrail against accident, not a security sandbox (mirrors the roadmap's own framing of §2). Chosen: "Loose".
- New `lib/repos/spaces.ts`: `listSpaces`, `getSpace`, `createSpace`, `renameSpace`, `deleteSpace`.
  `createSpace(db, name)` also **seeds** the new Space's `settings` row and its own Default agent (mirrors migration v9's seed), so a fresh Space is immediately usable.
  `deleteSpace` cascades away all the Space's data; the action guards against deleting the last Space.

## Engine

`runner.ts` currently calls `getSettings(db)` (the global row).
It now resolves settings from the running task's Space: `getSettings(db, task.space_id)`.
No other engine change — the run path is Space-agnostic by id.

## App / server actions

- `getActiveSpaceId` helper + `setActiveSpaceAction(spaceId)`.
- `createSpaceAction`, `renameSpaceAction`, `deleteSpaceAction`.
  - Create: seed via `createSpace`, then switch the cookie to it.
  - Delete: refuse the last Space; if deleting the active one, switch to another first; destructive confirm in the UI (cascade wipes its Projects/Tasks/Flows/Agents/Skills/Settings).
- Entity-create actions read the active Space and pass its id to the repo.
- All Server Component list reads (`layout.tsx` sidebar, `tasks/page`, `agents/choices`, `flows` pages) scope to `getActiveSpaceId(db)`.

## UI

- **Nav**: a Space switcher at the top of the sidebar — current Space name, dropdown to switch between Spaces, plus a "New space" affordance.
- **Settings page**: manage Spaces (rename, delete) alongside the now per-Space `retries` / `timeout` / `task_prefix`. (The owner asked for rename to live in settings.)

## Out of scope

- Space export/import (Roadmap §5 / §10).
- Per-tab divergent active Space.
- Strict cross-Space id isolation (see "Loose" above).

## Testing

- Migration: existing rows land in the seeded Space; the single settings row migrates; the Default agent is scoped.
- Per-Space uniqueness: same name in two Spaces is allowed; duplicate within one Space is rejected.
- `createSpace` seeds a settings row + exactly one Default agent.
- Scoped lists return only the active Space's rows; `countUnreadTasks` counts only the active Space.
- `deleteSpace` cascades and the last-Space guard holds.
- Engine reads per-Space settings from the task's Space.
