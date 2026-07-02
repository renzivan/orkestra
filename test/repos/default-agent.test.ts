import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Agents from "../../lib/repos/agents";
import * as Projects from "../../lib/repos/projects";
import * as Adapters from "../../lib/repos/adapters";
import * as Skills from "../../lib/repos/skills";
import * as Tasks from "../../lib/repos/tasks";

test("a Default agent is seeded, empty, adapterless, and marked is_default", () => {
  const db = openDb(":memory:");
  const def = Agents.getDefaultAgent(db);
  expect(def.name).toBe("Default");
  expect(def.is_default).toBe(true);
  expect(def.base_instruction).toBe("");
  expect(def.adapter_id).toBeNull();
});

test("there is exactly one default agent", () => {
  const db = openDb(":memory:");
  const n = (
    db.query("SELECT COUNT(*) AS n FROM agents WHERE is_default = 1").get() as {
      n: number;
    }
  ).n;
  expect(n).toBe(1);
});

test("the default agent cannot be deleted", () => {
  const db = openDb(":memory:");
  const def = Agents.getDefaultAgent(db);
  expect(() => Agents.deleteAgent(db, def.id)).toThrow(
    /default agent can't be deleted/i,
  );
  expect(Agents.getAgent(db, def.id)).not.toBeNull();
});

test("createAgent never marks a new agent as default", () => {
  const db = openDb(":memory:");
  const ad = Adapters.createAdapter(db, { name: "claude", command: "c {input}" });
  const a = Agents.createAgent(db, {
    name: "planner",
    base_instruction: "",
    adapter_id: ad.id,
    model: "sonnet",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  expect(Agents.getAgent(db, a.id)!.is_default).toBe(false);
});

test("deleting a normal agent reassigns its tasks to the Default agent", () => {
  const db = openDb(":memory:");
  const def = Agents.getDefaultAgent(db);
  const ad = Adapters.createAdapter(db, { name: "claude", command: "c {input}" });
  const a = Agents.createAgent(db, {
    name: "planner",
    base_instruction: "x",
    adapter_id: ad.id,
    model: "sonnet",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const t = Tasks.createTask(db, {
    title: "T",
    body: "b",
    target_type: "agent",
    target_id: a.id,
  });

  Agents.deleteAgent(db, a.id);

  expect(Agents.getAgent(db, a.id)).toBeNull();
  const got = Tasks.getTask(db, t.id)!;
  expect(got.target_type).toBe("agent");
  expect(got.target_id).toBe(def.id);
});

test("the default agent is scoped to all projects, including ones added later", () => {
  const db = openDb(":memory:");
  expect(Agents.getDefaultAgent(db).projects.length).toBe(0);

  Projects.createProject(db, { name: "app", path: "/app" });
  Projects.createProject(db, { name: "web", path: "/web" });

  const after = Agents.getDefaultAgent(db);
  expect(after.projects.map((p) => p.name)).toEqual(["app", "web"]);
});

test("updateAgent on the default keeps its name + is_default and ignores projects", () => {
  const db = openDb(":memory:");
  const def = Agents.getDefaultAgent(db);
  const ad = Adapters.createAdapter(db, { name: "claude", command: "c {input}" });
  const p1 = Projects.createProject(db, { name: "app", path: "/app" });
  Projects.createProject(db, { name: "web", path: "/web" });
  const s = Skills.createSkill(db, { name: "plan", body: "Plan." });

  Agents.updateAgent(db, def.id, {
    name: "Renamed", // ignored — stays "Default"
    base_instruction: "hello",
    adapter_id: ad.id,
    model: "opus",
    effort: "high",
    skill_ids: [s.id],
    project_ids: [p1.id], // ignored — default stays all-projects
  });

  const got = Agents.getDefaultAgent(db);
  expect(got.name).toBe("Default");
  expect(got.is_default).toBe(true);
  expect(got.base_instruction).toBe("hello");
  expect(got.adapter_id).toBe(ad.id);
  expect(got.model).toBe("opus");
  expect(got.skills.map((x) => x.id)).toEqual([s.id]);
  // all projects, not just the passed p1 — proves the list was ignored
  expect(got.projects.map((p) => p.name)).toEqual(["app", "web"]);
  const rows = (
    db
      .query("SELECT COUNT(*) AS n FROM agent_projects WHERE agent_id = ?")
      .get(def.id) as { n: number }
  ).n;
  expect(rows).toBe(0);
});
