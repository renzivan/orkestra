// Versioned migrations. Each entry is a set of statements that upgrades the DB
// from version index i to i+1, gated by PRAGMA user_version. Fresh DBs run all
// of them in order; existing DBs run only the ones past their current version.
// Never edit a shipped version in place — append a new one.
export const MIGRATIONS: string[][] = [
  // v1 — initial schema
  [
    `CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      command TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      base_instruction TEXT NOT NULL DEFAULT '',
      model_id INTEGER NOT NULL REFERENCES models(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL REFERENCES skills(id),
      position INTEGER NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_projects (
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      PRIMARY KEY (agent_id, project_id)
    )`,
    `CREATE TABLE IF NOT EXISTS flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `CREATE TABLE IF NOT EXISTS flow_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      position INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL CHECK (target_type IN ('flow','agent')),
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','succeeded','failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed')),
      final_output TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS run_steps (
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
        CHECK (status IN ('running','succeeded','failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      retries INTEGER NOT NULL DEFAULT 1,
      step_timeout_seconds INTEGER NOT NULL DEFAULT 600
    )`,
    `INSERT OR IGNORE INTO settings (id, retries, step_timeout_seconds)
      VALUES (1, 1, 600)`,
  ],

  // v2 — split the CLI "model" into an Adapter (the CLI) plus per-agent
  // model + thinking effort. The models table becomes the adapters table.
  [
    `ALTER TABLE models RENAME TO adapters`,
    `ALTER TABLE agents RENAME COLUMN model_id TO adapter_id`,
    `ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'sonnet'`,
    `ALTER TABLE agents ADD COLUMN effort TEXT NOT NULL DEFAULT ''`,
  ],

  // v3 — live transcript per step: a JSON array of activity entries (thinking,
  // tool calls, tool results, answer text) streamed and rendered as the step
  // runs. `output` remains the clean answer text chained into the next agent.
  [`ALTER TABLE run_steps ADD COLUMN transcript TEXT NOT NULL DEFAULT '[]'`],

  // v4 — capture the CLI session id per step so a finished run can be resumed
  // (the user replies to a question, continuing the same conversation).
  [`ALTER TABLE run_steps ADD COLUMN session_id TEXT`],

  // v5 — per-agent permission handling. Agents run headless (claude -p), so
  // there's no one to answer permission prompts; default to skipping them
  // (--dangerously-skip-permissions) so agents can actually act.
  [`ALTER TABLE agents ADD COLUMN skip_permissions INTEGER NOT NULL DEFAULT 1`],

  // v6 — add a 'stopped' status (user-initiated stop, distinct from a crash) to
  // tasks/runs/run_steps. SQLite can't alter a CHECK constraint, so each table
  // is rebuilt in place (create-new → copy → drop → rename), preserving all
  // columns and rows. FK enforcement is disabled for the swap so dropping a
  // referenced table doesn't error; the copied rows keep every relationship
  // intact. SELECT * relies on the new tables declaring columns in the same
  // order as the live ones (including v2–v4 additions at the end).
  [
    `PRAGMA foreign_keys=OFF`,

    `CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL CHECK (target_type IN ('flow','agent')),
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','succeeded','failed','stopped')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `INSERT INTO tasks_new SELECT * FROM tasks`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`,

    `CREATE TABLE runs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','succeeded','failed','stopped')),
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
        CHECK (status IN ('running','succeeded','failed','stopped')),
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

  // v7 — a short task key prefix (e.g. "ENG") shown before each task, rendered
  // as "<prefix>-<id>: <title>". Empty by default, so tasks show just their
  // title until a prefix is set on the settings page.
  [`ALTER TABLE settings ADD COLUMN task_prefix TEXT NOT NULL DEFAULT ''`],

  // v8 — deletion degrades downstream instead of being blocked. Previously a
  // referenced skill/project/adapter/agent could not be deleted (both an app
  // guard and these NO-ACTION foreign keys refused). Now:
  //   - deleting a skill/project drops it from every agent that used it
  //   - deleting an adapter nulls it out on agents (they become non-runnable
  //     until reassigned), rather than being refused
  //   - deleting an agent drops the flow steps that referenced it
  // SQLite can't alter a foreign key or a column's nullability in place, so the
  // affected tables are rebuilt (create-new → copy → drop → rename) with FK
  // enforcement off for the swap, exactly like v6. Column order on each _new
  // table matches the live table so `INSERT ... SELECT *` lines up (agents keeps
  // its v2/v5 trailing columns: model, effort, skip_permissions).
  [
    `PRAGMA foreign_keys=OFF`,

    // agents.adapter_id: nullable + ON DELETE SET NULL.
    `CREATE TABLE agents_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      base_instruction TEXT NOT NULL DEFAULT '',
      adapter_id INTEGER REFERENCES adapters(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'sonnet',
      effort TEXT NOT NULL DEFAULT '',
      skip_permissions INTEGER NOT NULL DEFAULT 1,
      UNIQUE(name)
    )`,
    `INSERT INTO agents_new SELECT * FROM agents`,
    `DROP TABLE agents`,
    `ALTER TABLE agents_new RENAME TO agents`,

    // agent_skills.skill_id: ON DELETE CASCADE (agent_id already cascades).
    `CREATE TABLE agent_skills_new (
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    )`,
    `INSERT INTO agent_skills_new SELECT * FROM agent_skills`,
    `DROP TABLE agent_skills`,
    `ALTER TABLE agent_skills_new RENAME TO agent_skills`,

    // agent_projects.project_id: ON DELETE CASCADE (agent_id already cascades).
    `CREATE TABLE agent_projects_new (
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, project_id)
    )`,
    `INSERT INTO agent_projects_new SELECT * FROM agent_projects`,
    `DROP TABLE agent_projects`,
    `ALTER TABLE agent_projects_new RENAME TO agent_projects`,

    // flow_steps.agent_id: ON DELETE CASCADE (flow_id already cascades). A
    // deleted agent drops its steps; remaining steps keep their positions
    // (gaps are fine — steps are read ordered by position, not by index).
    `CREATE TABLE flow_steps_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL
    )`,
    `INSERT INTO flow_steps_new SELECT * FROM flow_steps`,
    `DROP TABLE flow_steps`,
    `ALTER TABLE flow_steps_new RENAME TO flow_steps`,

    `PRAGMA foreign_keys=ON`,
  ],

  // v9 — a built-in Default agent. It always exists, can't be deleted, is
  // preselected when creating a task, and absorbs orphaned tasks: deleting a
  // normal agent reassigns any task that targeted it to this one instead of
  // leaving it non-runnable. Seeded with an empty instruction and no adapter,
  // so it's configured (adapter/model) before it can run. The partial unique
  // index guarantees at most one default. `is_default` is appended (ADD COLUMN,
  // not a rebuild), so getAgent's `SELECT *` mapping stays order-independent.
  [
    `ALTER TABLE agents ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`,
    `CREATE UNIQUE INDEX agents_one_default ON agents(is_default) WHERE is_default = 1`,
    `INSERT INTO agents
       (name, base_instruction, adapter_id, model, effort, skip_permissions, is_default, created_at, updated_at)
     VALUES
       ('Default', '', NULL, '', '', 1, 1,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  ],

  // v10 — unread tracking for the sidebar Tasks badge. `settled_at` records when
  // a task last entered a terminal status; `seen_at` records when the user last
  // opened its detail page. A task is unread while settled and seen_at is null or
  // older than settled_at (see countUnreadTasks). Kept separate from updated_at so
  // a future task edit (which bumps updated_at) can't falsely re-flag a read task.
  // Both are ADD COLUMN (appended), so getTask's `SELECT *` mapping stays
  // order-independent. Backfill starts the badge clean: existing terminal rows are
  // marked settled and already seen; non-terminal rows keep both null.
  [
    `ALTER TABLE tasks ADD COLUMN settled_at TEXT`,
    `ALTER TABLE tasks ADD COLUMN seen_at TEXT`,
    `UPDATE tasks SET settled_at = updated_at, seen_at = updated_at
       WHERE status IN ('succeeded','failed','stopped')`,
  ],

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

  // v12 — an agent's instructions become an ordered set of named files instead
  // of one `base_instruction` blob. Each file has a name, a markdown body, a
  // position, and an entry flag; exactly one file per agent is the ENTRY (it
  // composes first). The partial unique index enforces one entry per agent,
  // mirroring `agents_one_default`. Backfill turns every agent's existing
  // base_instruction into a single ENTRY file named `AGENTS.md` (empty bodies
  // included — e.g. the seeded Default agent), so nothing is lost. Then the now-
  // dead column is dropped; DROP COLUMN is safe here because base_instruction is
  // not part of any index or PK, so no table rebuild (v6/v8 style) is needed.
  [
    `CREATE TABLE agent_instructions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      is_entry INTEGER NOT NULL DEFAULT 0,
      UNIQUE(agent_id, name)
    )`,
    `CREATE UNIQUE INDEX agent_one_entry
       ON agent_instructions(agent_id) WHERE is_entry = 1`,
    `INSERT INTO agent_instructions (agent_id, name, body, position, is_entry)
       SELECT id, 'AGENTS.md', base_instruction, 0, 1 FROM agents`,
    `ALTER TABLE agents DROP COLUMN base_instruction`,
  ],

  // v13 — Spaces: top-level isolation in a single DB (Roadmap §1). A Space is a
  // container; every top-level entity carries a space_id and is wiped when its
  // Space is deleted. Switching the active Space is a pure view filter (a cookie
  // in the app layer) — the engine never reads it, so a run in one Space keeps
  // going while you view another.
  //
  // A single Space named 'ETel' is seeded to hold all existing data; because the
  // spaces table is brand-new, that row's id is 1 on every database (fresh or
  // upgraded), so backfills point every existing row at it. The five top-level
  // tables (skills/projects/agents/flows/tasks) plus settings are rebuilt to add
  // space_id — SQLite can't add a NOT NULL REFERENCES column or change a UNIQUE
  // constraint in place — using the same create-new -> copy -> drop -> rename swap
  // as v6/v8/v11 (FK enforcement off for the swap; ids preserved so every child
  // FK stays intact, including agent_instructions -> agents from v12). Changes:
  //   - name uniqueness is now per-Space: UNIQUE(name) -> UNIQUE(space_id, name),
  //     so "Deploy" can exist in both a personal and a work Space.
  //   - the single Default agent becomes one-per-Space: the agents_one_default
  //     index moves from ON(is_default) to ON(space_id) WHERE is_default = 1.
  //   - settings goes from a single row (id = 1) to one row per Space, keyed by
  //     space_id; the existing row is copied onto the seeded Space.
  //   - the tasks rebuild carries forward v11's 'paused' status in the CHECK.
  //   - the agents rebuild has no base_instruction column (dropped in v12); the
  //     agent_instructions rows survive the swap via preserved agent ids.
  //   - runs/run_steps get no column — they inherit scope via the tasks FK.
  //   - adapters stay global (detected from PATH, Space-independent).
  // Explicit column lists (not SELECT *) keep the copies stable as columns grow.
  [
    `CREATE TABLE spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name)
    )`,
    `INSERT INTO spaces (name, created_at, updated_at)
     VALUES ('ETel', strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,

    `PRAGMA foreign_keys=OFF`,

    // skills
    `CREATE TABLE skills_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      UNIQUE(space_id, name)
    )`,
    `INSERT INTO skills_new (id, name, body, created_at, updated_at, space_id)
     SELECT id, name, body, created_at, updated_at,
            (SELECT id FROM spaces ORDER BY id LIMIT 1) FROM skills`,
    `DROP TABLE skills`,
    `ALTER TABLE skills_new RENAME TO skills`,

    // projects
    `CREATE TABLE projects_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      UNIQUE(space_id, name)
    )`,
    `INSERT INTO projects_new (id, name, path, created_at, updated_at, space_id)
     SELECT id, name, path, created_at, updated_at,
            (SELECT id FROM spaces ORDER BY id LIMIT 1) FROM projects`,
    `DROP TABLE projects`,
    `ALTER TABLE projects_new RENAME TO projects`,

    // agents — base_instruction was dropped in v12; keeps the v8 nullable/SET-NULL
    // adapter_id and the v2/v5/v9 trailing columns; space_id appended; unique name
    // scoped per Space. agent_instructions rows are untouched (agent ids preserved).
    `CREATE TABLE agents_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      adapter_id INTEGER REFERENCES adapters(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'sonnet',
      effort TEXT NOT NULL DEFAULT '',
      skip_permissions INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      UNIQUE(space_id, name)
    )`,
    `INSERT INTO agents_new
       (id, name, adapter_id, created_at, updated_at,
        model, effort, skip_permissions, is_default, space_id)
     SELECT id, name, adapter_id, created_at, updated_at,
            model, effort, skip_permissions, is_default,
            (SELECT id FROM spaces ORDER BY id LIMIT 1) FROM agents`,
    `DROP TABLE agents`,
    `ALTER TABLE agents_new RENAME TO agents`,
    // One Default agent per Space (was one globally).
    `CREATE UNIQUE INDEX agents_one_default ON agents(space_id) WHERE is_default = 1`,

    // flows
    `CREATE TABLE flows_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      UNIQUE(space_id, name)
    )`,
    `INSERT INTO flows_new (id, name, created_at, updated_at, space_id)
     SELECT id, name, created_at, updated_at,
            (SELECT id FROM spaces ORDER BY id LIMIT 1) FROM flows`,
    `DROP TABLE flows`,
    `ALTER TABLE flows_new RENAME TO flows`,

    // tasks — preserves v11's 'paused' CHECK and v10's unread columns; adds space_id.
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
      seen_at TEXT,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE
    )`,
    `INSERT INTO tasks_new
       (id, title, body, target_type, target_id, status, created_at, updated_at,
        settled_at, seen_at, space_id)
     SELECT id, title, body, target_type, target_id, status, created_at,
            updated_at, settled_at, seen_at,
            (SELECT id FROM spaces ORDER BY id LIMIT 1) FROM tasks`,
    `DROP TABLE tasks`,
    `ALTER TABLE tasks_new RENAME TO tasks`,

    // settings — from a single row (id = 1) to one row per Space.
    `CREATE TABLE settings_new (
      space_id INTEGER PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      retries INTEGER NOT NULL DEFAULT 1,
      step_timeout_seconds INTEGER NOT NULL DEFAULT 600,
      task_prefix TEXT NOT NULL DEFAULT ''
    )`,
    `INSERT INTO settings_new (space_id, retries, step_timeout_seconds, task_prefix)
     SELECT (SELECT id FROM spaces ORDER BY id LIMIT 1),
            retries, step_timeout_seconds, task_prefix FROM settings`,
    `DROP TABLE settings`,
    `ALTER TABLE settings_new RENAME TO settings`,

    `PRAGMA foreign_keys=ON`,
  ],

  // v14 — token usage per step (Roadmap §9). The four counts a CLI reports for
  // one invocation, kept apart (cache reads usually dominate a Claude run).
  // Nullable: NULL means "the adapter reported no usage", distinct from a real 0.
  // Per-run and per-agent totals are SUMs over these columns, computed in reads.
  [
    `ALTER TABLE run_steps ADD COLUMN input_tokens INTEGER`,
    `ALTER TABLE run_steps ADD COLUMN output_tokens INTEGER`,
    `ALTER TABLE run_steps ADD COLUMN cache_creation_tokens INTEGER`,
    `ALTER TABLE run_steps ADD COLUMN cache_read_tokens INTEGER`,
  ],
];
