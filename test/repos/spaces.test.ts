import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Spaces from "../../lib/repos/spaces";
import * as Agents from "../../lib/repos/agents";
import * as Skills from "../../lib/repos/skills";
import * as Tasks from "../../lib/repos/tasks";
import * as Settings from "../../lib/repos/settings";

const SEED = 1; // the "ETel" Space seeded by migration v12

test("a single Space is seeded by migration, and is the default", () => {
  const db = openDb(":memory:");
  const all = Spaces.listSpaces(db);
  expect(all.length).toBe(1);
  expect(all[0].name).toBe("ETel");
  expect(Spaces.defaultSpace(db).id).toBe(all[0].id);
});

test("createSpace seeds the new Space its own settings row and one Default agent", () => {
  const db = openDb(":memory:");
  const work = Spaces.createSpace(db, { name: "Work" });

  // Its own settings row (defaults), independent of the seeded Space.
  const settings = Settings.getSettings(db, work.id);
  expect(settings.retries).toBe(1);
  expect(settings.step_timeout_seconds).toBe(600);
  expect(settings.task_prefix).toBe("");

  // Its own Default agent — exactly one, scoped to this Space.
  const def = Agents.getDefaultAgent(db, work.id);
  expect(def.name).toBe("Default");
  expect(def.is_default).toBe(true);

  // Two Default agents total now (one per Space), not one globally.
  const n = (db.query("SELECT COUNT(*) AS n FROM agents WHERE is_default=1").get() as { n: number }).n;
  expect(n).toBe(2);
});

test("lists are isolated per Space", () => {
  const db = openDb(":memory:");
  const work = Spaces.createSpace(db, { name: "Work" });

  Skills.createSkill(db, SEED, { name: "seed-skill", body: "" });
  Skills.createSkill(db, work.id, { name: "work-skill", body: "" });

  expect(Skills.listSkills(db, SEED).map((s) => s.name)).toEqual(["seed-skill"]);
  expect(Skills.listSkills(db, work.id).map((s) => s.name)).toEqual(["work-skill"]);
});

test("countUnreadTasks is scoped to a Space", () => {
  const db = openDb(":memory:");
  const work = Spaces.createSpace(db, { name: "Work" });

  const a = Tasks.createTask(db, SEED, { title: "A", body: "", target_type: "agent", target_id: 1 });
  Tasks.setTaskStatus(db, a.id, "succeeded");
  const b = Tasks.createTask(db, work.id, { title: "B", body: "", target_type: "agent", target_id: 1 });
  Tasks.setTaskStatus(db, b.id, "succeeded");

  expect(Tasks.countUnreadTasks(db, SEED)).toBe(1);
  expect(Tasks.countUnreadTasks(db, work.id)).toBe(1);
});

test("deleteSpace cascades away all of the Space's data", () => {
  const db = openDb(":memory:");
  const work = Spaces.createSpace(db, { name: "Work" });
  Skills.createSkill(db, work.id, { name: "s", body: "" });
  Tasks.createTask(db, work.id, { title: "T", body: "", target_type: "agent", target_id: 1 });

  const res = Spaces.deleteSpace(db, work.id);
  expect(res.ok).toBe(true);

  expect(Skills.listSkills(db, work.id).length).toBe(0);
  expect(Tasks.listTasks(db, work.id).length).toBe(0);
  // Its Default agent and settings row are gone too (FK cascade).
  expect((db.query("SELECT COUNT(*) AS n FROM agents WHERE space_id=?").get(work.id) as { n: number }).n).toBe(0);
  expect((db.query("SELECT COUNT(*) AS n FROM settings WHERE space_id=?").get(work.id) as { n: number }).n).toBe(0);
});

test("deleteSpace refuses to remove the last remaining Space", () => {
  const db = openDb(":memory:");
  const res = Spaces.deleteSpace(db, SEED);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toMatch(/last space/i);
  expect(Spaces.listSpaces(db).length).toBe(1);
});

test("renameSpace changes the name", () => {
  const db = openDb(":memory:");
  const renamed = Spaces.renameSpace(db, SEED, "Personal");
  expect(renamed.name).toBe("Personal");
  expect(Spaces.getSpace(db, SEED)!.name).toBe("Personal");
});
