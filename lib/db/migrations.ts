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
];
