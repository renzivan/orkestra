# Agent instruction files — design

## Summary

Replace an agent's single `base_instruction` textarea with an ordered set of named **instruction files** (filename + markdown body), one of which is marked **ENTRY**.
At run time all files are concatenated into the same system prompt string the agent already uses, ENTRY first, then the rest in position order, each under a `# filename` heading, followed by skill bodies as today.

The model is inspired by Paperclip's per-agent instruction bundle (an `AGENTS.md` entry file alongside `SOUL.md`, `TOOLS.md`, etc.), but adapted to orkestra's architecture: orkestra has no per-agent working directory, and the system prompt is a single string interpolated into the CLI command via the `{system}` placeholder.
So files are stored in the database and composed eagerly into that string, not written to disk and read lazily by the agent.

## Motivation

Today an agent's behavior is one opaque blob of text in `base_instruction`.
Splitting it into named files lets a user organize an agent's instructions into legible pieces — identity, persona, tool rules, per-run checklist — the same way a repo splits guidance across `AGENTS.md` / `CONTEXT.md`.
It reads better, edits better, and mirrors a pattern users already know.

## Decisions (locked)

- **Replace, don't augment.** The single `base_instruction` field is removed. An agent's instructions are now purely the ordered file set.
- **Eager composition.** Every file is appended to the system prompt on every run. No lazy on-demand file reading, no per-agent workspace. Chosen because instruction sets are small, "always in context" is more reliable than hoping the agent opens a file, and it fits orkestra's string-based `{system}` model with minimal new plumbing.
- **Exactly one ENTRY.** Every agent has exactly one file flagged ENTRY. It composes first. It cannot be deleted (delete another file, or reassign ENTRY first).
- **Headed blocks.** Each file body is prefixed with `# <filename>` in the composed prompt so the model can tell the pieces apart. Skills are unchanged (raw bodies, no header).
- **Migration.** Each existing agent's `base_instruction` becomes a single ENTRY file named `AGENTS.md` holding that text (empty body is fine — e.g. the seeded Default agent).

## Data model

New table `agent_instructions`:

```sql
CREATE TABLE agent_instructions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL,
  is_entry   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(agent_id, name)
);
CREATE UNIQUE INDEX agent_one_entry ON agent_instructions(agent_id) WHERE is_entry = 1;
```

`agent_id` cascades on agent delete, matching `agent_skills` / `agent_projects`.
`UNIQUE(agent_id, name)` keeps filenames distinct within one agent.
The partial unique index guarantees at most one ENTRY per agent, mirroring the existing `agents_one_default` pattern.
`position` orders the non-entry files; the ENTRY file's position is irrelevant to composition (it always leads) but is stored for stable list rendering.

### Migration (new entry appended to `MIGRATIONS`, the 11th)

```sql
-- 1. create the table + index (as above)
-- 2. backfill: every agent gets one ENTRY file from its base_instruction
INSERT INTO agent_instructions (agent_id, name, body, position, is_entry)
  SELECT id, 'AGENTS.md', base_instruction, 0, 1 FROM agents;
-- 3. drop the now-dead column
ALTER TABLE agents DROP COLUMN base_instruction;
```

`ALTER TABLE ... DROP COLUMN` is supported by the modern SQLite bun ships, and `base_instruction` is not part of any index or PK, so no full table rebuild (create-new → copy → drop → rename) is needed — unlike v6/v8.
If a rebuild is ever preferred for consistency with those migrations, that is a fallback, but the plain `DROP COLUMN` is simpler and sufficient here.

## Types (`lib/types.ts`)

New:

```ts
export interface AgentInstruction {
  id: number;
  name: string;
  body: string;
  position: number;
  is_entry: boolean;
}
```

`Agent` loses `base_instruction` and gains `instructions: AgentInstruction[]`.

`AgentInput` (in `lib/repos/agents.ts`) loses `base_instruction` and gains:

```ts
instructions: { name: string; body: string; is_entry: boolean }[];
```

Array order is the stored `position`. Exactly one element must have `is_entry: true`.

## Repository (`lib/repos/agents.ts`)

- `writeRelations` also writes instruction rows (delete-then-reinsert on update, like skills). Position = array index.
- `getAgent` loads instructions for the agent (ordered by `position`), maps `is_entry` 0/1 → boolean, and attaches them as `instructions`.
- Validation (thrown as `Error`, surfaced in the form): at least one file; exactly one `is_entry`; every name non-empty and unique within the agent. If a caller sends zero entry flags, reject rather than silently guessing.

## Composition (`lib/engine/runner.ts`)

`buildSystem` changes from:

```ts
return [agent.base_instruction, ...agent.skills.map((s) => s.body)]
  .filter((p) => p.trim().length > 0)
  .join("\n\n");
```

to compose the files ENTRY-first, then non-entry files by position, each headed by its filename, then skills unchanged:

```ts
function buildSystem(agent: Agent): string {
  const files = [...agent.instructions].sort(
    (a, b) => Number(b.is_entry) - Number(a.is_entry) || a.position - b.position,
  );
  const blocks = files
    .filter((f) => f.body.trim().length > 0)
    .map((f) => `# ${f.name}\n${f.body}`);
  return [...blocks, ...agent.skills.map((s) => s.body)]
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}
```

Empty-bodied files drop out (so an empty seeded ENTRY contributes nothing), exactly as an empty `base_instruction` did before.

## UI (`app/agents/agent-form.tsx`)

Replace the single "Base instruction" textarea (and its `base`/`setBase` state) with an instruction-files editor, porting the approved mockup into React:

- A **Files** list: each row shows the filename, an ENTRY badge on the entry file, and a byte-size badge. Row hover reveals move-up / move-down / delete controls. The ENTRY file's delete is disabled.
- Clicking a row selects it for editing below: a filename input, a markdown body textarea, and a "Use as ENTRY file" radio that reassigns ENTRY (clearing it from the previous holder).
- An **+ Add file** button appends a new empty file with a suggested unique name (e.g. `NOTES.md`).
- Client-side guards mirror the repo validation: block save on duplicate/empty names or zero files; ENTRY is always exactly one (reassignable, never zero).

State shape: `instructions: { name; body; is_entry }[]` plus a `selected` index. `save()` sends `instructions` instead of `base_instruction`.

The rest of the agent form (name, adapter, model, effort, skip-permissions, skills, projects) is unchanged. We are not introducing Paperclip's tabbed layout — instructions remain a section on the existing single-page form.

## Server action (`app/actions.ts`)

`saveAgent` input type swaps `base_instruction: string` for `instructions: {...}[]`, passed straight through to the repo. No other logic change.

## Ripple: other `base_instruction` references

Every read of `base_instruction` must move to the new shape. The full set of files that mention `base_instruction` today (from `grep -rl base_instruction app lib scripts test`):

Application / library:

- `app/actions.ts` — `saveAgent` input type (see above).
- `app/agents/agent-form.tsx` — the form (see above).
- `lib/types.ts` — the `Agent` / input types (see above).
- `lib/repos/agents.ts` — create/update/get (see above).
- `lib/engine/runner.ts` — `buildSystem` (see above).
- `lib/db/migrations.ts` — the existing migrations (unchanged; new entry appended).

Tests (each constructs an `AgentInput` inline — there is **no shared agent factory**, so every one must be updated individually):

`test/repos/agents.test.ts`, `test/repos/default-agent.test.ts`, `test/repos/flows.test.ts`, `test/engine/runner.test.ts` (asserts on the composed prompt — update to the headed multi-file format), `test/engine/stop-resume.test.ts`, `test/db.test.ts`, `test/refs.test.ts`, `test/e2e.test.ts`, `test/actions.test.ts`, `test/adapters-sync.test.ts`, `test/stream.test.ts`, `test/runnable.test.ts`.

To avoid repeating the instruction shape at every call site, a small shared helper `entryFile(body)` (in `test/support.ts`) returns a single-ENTRY `[{ name: "AGENTS.md", body, is_entry: true }]` array. The existing inline `base_instruction: "x"` fields become `instructions: entryFile("x")`, preserving each test's intent while centralising the shape. Assertions on `got.base_instruction` become assertions on `got.instructions`.

(`scripts/seed.ts` does not create agents — it only prints a getting-started hint — so it needs no change.)

## Testing

- **Repo:** create/update an agent with several files; assert ordering, ENTRY flag, unique-name and single-entry validation errors, and cascade delete of instruction rows with the agent.
- **Composition:** `buildSystem` puts ENTRY first, heads each block with `# name`, drops empty-bodied files, and appends skills after — a table of file sets → expected string.
- **Migration:** open a DB seeded at the previous version with agents carrying `base_instruction`, run migrations, assert each agent has one `AGENTS.md` ENTRY row with the old text and that `base_instruction` is gone.
- **Default agent:** still seeded correctly — its ENTRY file exists with an empty body and it stays undeletable / name-locked.

## Out of scope (YAGNI)

- Lazy / on-demand file reading and any per-agent working directory.
- A per-file "always in prompt vs available as a file" toggle.
- A reusable cross-agent instruction library.
- Injecting new instructions into an already-running agent.
- Paperclip's tabbed agent navigation.
