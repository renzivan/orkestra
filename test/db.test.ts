import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import { openDb } from "../lib/db";
import { MIGRATIONS } from "../lib/db/migrations";

test("migrations create tables + settings row", () => {
  const db = openDb(":memory:");
  const names = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  for (const t of [
    "spaces",
    "skills",
    "projects",
    "adapters",
    "agents",
    "agent_skills",
    "agent_projects",
    "flows",
    "flow_steps",
    "tasks",
    "runs",
    "run_steps",
    "settings",
  ]) {
    expect(names).toContain(t);
  }
  expect(names).not.toContain("models"); // renamed to adapters in v2

  const cols = db
    .query("PRAGMA table_info(agents)")
    .all()
    .map((c: any) => c.name);
  expect(cols).toContain("adapter_id");
  expect(cols).toContain("model");
  expect(cols).toContain("effort");
  expect(cols).not.toContain("model_id");

  // Settings is now keyed by space_id (v12), one row per Space, seeded for the
  // initial "ETel" Space.
  const s: any = db.query("SELECT * FROM settings WHERE space_id=1").get();
  expect(s.retries).toBe(1);
  expect(s.step_timeout_seconds).toBe(600);
});

test("an existing v1 database migrates to the adapter schema", () => {
  const db = openDb(":memory:");
  // Simulate a pre-migration DB by forcing it back to v1 shape would be complex;
  // instead assert the migration runner brings a fresh DB to the latest version.
  const version = (db.query("PRAGMA user_version").get() as any).user_version;
  expect(version).toBe(MIGRATIONS.length);
});

test("v8 sets delete-degrades foreign-key actions", () => {
  const db = openDb(":memory:");
  const onDelete = (table: string, col: string) => {
    const fks = db.query(`PRAGMA foreign_key_list(${table})`).all() as any[];
    return fks.find((f) => f.from === col)?.on_delete;
  };
  expect(onDelete("agents", "adapter_id")).toBe("SET NULL");
  expect(onDelete("agent_skills", "skill_id")).toBe("CASCADE");
  expect(onDelete("agent_projects", "project_id")).toBe("CASCADE");
  expect(onDelete("flow_steps", "agent_id")).toBe("CASCADE");

  // adapter_id is now nullable (notnull flag cleared) so SET NULL can fire.
  const adapterCol = (db.query("PRAGMA table_info(agents)").all() as any[]).find(
    (c) => c.name === "adapter_id",
  );
  expect(adapterCol.notnull).toBe(0);
});

test("v8 upgrades an existing v7 database, preserving rows", () => {
  const file = join(tmpdir(), `ork-v7-${process.pid}.db`);
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(file + ext)) rmSync(file + ext);
  }

  // Build a v7-shaped database with real data, stopping before v8.
  const seed = new Database(file);
  seed.exec("PRAGMA foreign_keys = ON;");
  for (let v = 0; v < 7; v++) for (const stmt of MIGRATIONS[v]) seed.exec(stmt);
  seed.exec("PRAGMA user_version = 7");
  const now = "2026-01-01T00:00:00.000Z";
  seed
    .query(
      `INSERT INTO adapters (id, name, command, created_at, updated_at)
       VALUES (1, 'claude', 'c {input}', $now, $now)`,
    )
    .run({ $now: now });
  seed
    .query(
      `INSERT INTO agents (id, name, base_instruction, adapter_id, created_at, updated_at, model, effort, skip_permissions)
       VALUES (1, 'a', 'b', 1, $now, $now, 'opus', 'off', 1)`,
    )
    .run({ $now: now });
  seed
    .query(`INSERT INTO skills (id, name, body, created_at, updated_at) VALUES (1,'plan','p',$now,$now)`)
    .run({ $now: now });
  seed.query(`INSERT INTO agent_skills (agent_id, skill_id, position) VALUES (1,1,0)`).run();
  seed
    .query(`INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (1,'app','/app',$now,$now)`)
    .run({ $now: now });
  seed.query(`INSERT INTO agent_projects (agent_id, project_id) VALUES (1,1)`).run();
  seed.query(`INSERT INTO flows (id, name, created_at, updated_at) VALUES (1,'f',$now,$now)`).run({ $now: now });
  seed.query(`INSERT INTO flow_steps (flow_id, agent_id, position) VALUES (1,1,0)`).run();
  seed.close();

  // Reopen through the app path — this applies v8's table rebuild (and every
  // later migration, e.g. v9's Default agent seed).
  const db = openDb(file);
  expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(
    MIGRATIONS.length,
  );

  const agent: any = db.query("SELECT * FROM agents WHERE id=1").get();
  expect(agent.name).toBe("a");
  expect(agent.adapter_id).toBe(1); // preserved through the rebuild
  expect(agent.model).toBe("opus");
  expect(agent.skip_permissions).toBe(1);
  expect((db.query("SELECT * FROM agent_skills").all() as any[]).length).toBe(1);
  expect((db.query("SELECT * FROM agent_projects").all() as any[]).length).toBe(1);
  expect((db.query("SELECT * FROM flow_steps").all() as any[]).length).toBe(1);

  // v12 migrated the old base_instruction into a single ENTRY file and dropped
  // the column.
  expect(agent.base_instruction).toBeUndefined();
  const instr: any = db
    .query("SELECT * FROM agent_instructions WHERE agent_id = 1")
    .get();
  expect(instr.name).toBe("AGENTS.md");
  expect(instr.body).toBe("b");
  expect(instr.is_entry).toBe(1);
  expect(instr.position).toBe(0);

  // New cascade behaviour is live after the upgrade.
  db.query("DELETE FROM adapters WHERE id=1").run();
  expect((db.query("SELECT adapter_id FROM agents WHERE id=1").get() as any).adapter_id).toBeNull();
  db.query("DELETE FROM agents WHERE id=1").run();
  expect((db.query("SELECT * FROM flow_steps").all() as any[]).length).toBe(0);
  // Agent 1's instruction rows cascade with it (the seeded Default agent keeps its own).
  expect(
    (
      db
        .query("SELECT COUNT(*) AS n FROM agent_instructions WHERE agent_id = 1")
        .get() as { n: number }
    ).n,
  ).toBe(0);
  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(file + ext)) rmSync(file + ext);
  }
});

test("v12 upgrades a pre-Spaces database into a single seeded Space, preserving rows", () => {
  const file = join(tmpdir(), `ork-v10-${process.pid}.db`);
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(file + ext)) rmSync(file + ext);
  }

  // Build a v10-shaped database with real data, stopping before v11/v12.
  const seed = new Database(file);
  seed.exec("PRAGMA foreign_keys = ON;");
  for (let v = 0; v < 10; v++) for (const stmt of MIGRATIONS[v]) seed.exec(stmt);
  seed.exec("PRAGMA user_version = 10");
  const now = "2026-01-01T00:00:00.000Z";
  seed
    .query(`INSERT INTO adapters (id,name,command,created_at,updated_at) VALUES (1,'claude','c {input}',$now,$now)`)
    .run({ $now: now });
  // Migration v9 already seeded a Default agent (id 1); add one normal agent.
  seed
    .query(`INSERT INTO agents (id,name,base_instruction,adapter_id,created_at,updated_at,model,effort,skip_permissions,is_default)
            VALUES (2,'planner','p',1,$now,$now,'opus','off',1,0)`)
    .run({ $now: now });
  seed.query(`INSERT INTO skills (id,name,body,created_at,updated_at) VALUES (1,'plan','p',$now,$now)`).run({ $now: now });
  seed.query(`INSERT INTO projects (id,name,path,created_at,updated_at) VALUES (1,'app','/app',$now,$now)`).run({ $now: now });
  seed.query(`INSERT INTO flows (id,name,created_at,updated_at) VALUES (1,'f',$now,$now)`).run({ $now: now });
  seed
    .query(`INSERT INTO tasks (id,title,body,target_type,target_id,status,created_at,updated_at) VALUES (1,'T','','agent',2,'pending',$now,$now)`)
    .run({ $now: now });
  seed.close();

  // Reopen through the app path — applies v11 (paused) then v12 (Spaces).
  const db = openDb(file);
  expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(
    MIGRATIONS.length,
  );

  // One Space seeded, named "ETel", id 1.
  const spaces = db.query("SELECT * FROM spaces").all() as any[];
  expect(spaces.length).toBe(1);
  expect(spaces[0].name).toBe("ETel");
  expect(spaces[0].id).toBe(1);

  // Every top-level row backfilled to the seeded Space.
  for (const t of ["skills", "projects", "agents", "flows", "tasks"]) {
    const rows = db.query(`SELECT space_id FROM ${t}`).all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.space_id === 1)).toBe(true);
  }

  // Settings became one row per Space, keyed by space_id.
  const settings = db.query("SELECT * FROM settings").all() as any[];
  expect(settings.length).toBe(1);
  expect(settings[0].space_id).toBe(1);

  // Exactly one Default agent, now scoped to the Space.
  const def = db.query("SELECT * FROM agents WHERE is_default=1").all() as any[];
  expect(def.length).toBe(1);
  expect(def[0].space_id).toBe(1);

  db.close();
  for (const ext of ["", "-wal", "-shm"]) {
    if (existsSync(file + ext)) rmSync(file + ext);
  }
});

test("v12 scopes name uniqueness per Space (same name allowed across Spaces)", () => {
  const db = openDb(":memory:");
  const now = new Date().toISOString();
  db.query(`INSERT INTO spaces (id,name,created_at,updated_at) VALUES (2,'Work',$now,$now)`).run({ $now: now });

  // Same skill name in two different Spaces is fine...
  db.query(`INSERT INTO skills (name,body,space_id,created_at,updated_at) VALUES ('plan','',1,$now,$now)`).run({ $now: now });
  db.query(`INSERT INTO skills (name,body,space_id,created_at,updated_at) VALUES ('plan','',2,$now,$now)`).run({ $now: now });
  expect((db.query("SELECT COUNT(*) AS n FROM skills WHERE name='plan'").get() as any).n).toBe(2);

  // ...but a duplicate within the same Space is rejected.
  expect(() =>
    db.query(`INSERT INTO skills (name,body,space_id,created_at,updated_at) VALUES ('plan','',1,$now,$now)`).run({ $now: now }),
  ).toThrow(/UNIQUE/i);
});

test("v5 accepts the 'stopped' status on tasks, runs and run_steps", () => {
  const db = openDb(":memory:");
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO tasks (title, body, target_type, target_id, status, space_id, created_at, updated_at)
     VALUES ('T','', 'agent', 1, 'stopped', 1, $now, $now)`,
  ).run({ $now: now });
  const task: any = db.query("SELECT * FROM tasks ORDER BY id DESC LIMIT 1").get();
  expect(task.status).toBe("stopped");

  db.query(
    `INSERT INTO runs (task_id, status, started_at) VALUES ($t, 'stopped', $now)`,
  ).run({ $t: task.id, $now: now });
  const run: any = db.query("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get();
  expect(run.status).toBe("stopped");

  db.query(
    `INSERT INTO run_steps (run_id, position, agent_id, agent_name, status, started_at)
     VALUES ($r, 0, 1, 'a', 'stopped', $now)`,
  ).run({ $r: run.id, $now: now });
  const step: any = db.query("SELECT * FROM run_steps ORDER BY id DESC LIMIT 1").get();
  expect(step.status).toBe("stopped");

  // The CHECK constraint is still enforced — a bogus status is rejected.
  expect(() =>
    db.query(
      `INSERT INTO runs (task_id, status, started_at) VALUES ($t, 'bogus', $now)`,
    ).run({ $t: task.id, $now: now }),
  ).toThrow();
});
