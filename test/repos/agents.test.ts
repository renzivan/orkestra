import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Skills from "../../lib/repos/skills";
import * as Projects from "../../lib/repos/projects";
import * as Models from "../../lib/repos/models";
import * as R from "../../lib/repos/agents";

function fixtures(db: ReturnType<typeof openDb>) {
  const m = Models.createModel(db, { name: "claude", command: "claude {input}" });
  const s1 = Skills.createSkill(db, { name: "plan", body: "Plan first." });
  const s2 = Skills.createSkill(db, { name: "tdd", body: "Test first." });
  const p = Projects.createProject(db, { name: "app", path: "/app" });
  return { m, s1, s2, p };
}

test("agent keeps skill order and nests projects", () => {
  const db = openDb(":memory:");
  const { m, s1, s2, p } = fixtures(db);

  const a = R.createAgent(db, {
    name: "planner",
    base_instruction: "You plan.",
    model_id: m.id,
    skill_ids: [s2.id, s1.id],
    project_ids: [p.id],
  });

  const got = R.getAgent(db, a.id)!;
  expect(got.skills.map((s) => s.id)).toEqual([s2.id, s1.id]); // order preserved
  expect(got.projects.length).toBe(1);
  expect(got.model_id).toBe(m.id);
});

test("agent with zero skills and zero projects is valid", () => {
  const db = openDb(":memory:");
  const { m } = fixtures(db);

  const b = R.createAgent(db, {
    name: "bare",
    base_instruction: "hi",
    model_id: m.id,
    skill_ids: [],
    project_ids: [],
  });
  expect(R.getAgent(db, b.id)!.skills.length).toBe(0);
  expect(R.getAgent(db, b.id)!.projects.length).toBe(0);
});

test("updateAgent replaces skill set and order", () => {
  const db = openDb(":memory:");
  const { m, s1, s2, p } = fixtures(db);
  const a = R.createAgent(db, {
    name: "planner",
    base_instruction: "You plan.",
    model_id: m.id,
    skill_ids: [s1.id],
    project_ids: [],
  });

  R.updateAgent(db, a.id, {
    name: "planner",
    base_instruction: "You plan well.",
    model_id: m.id,
    skill_ids: [s2.id, s1.id],
    project_ids: [p.id],
  });

  const got = R.getAgent(db, a.id)!;
  expect(got.base_instruction).toBe("You plan well.");
  expect(got.skills.map((s) => s.id)).toEqual([s2.id, s1.id]);
  expect(got.projects.length).toBe(1);
});
