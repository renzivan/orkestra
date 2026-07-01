import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Skills from "../../lib/repos/skills";
import * as Projects from "../../lib/repos/projects";
import * as Adapters from "../../lib/repos/adapters";
import * as R from "../../lib/repos/agents";

function fixtures(db: ReturnType<typeof openDb>) {
  const ad = Adapters.createAdapter(db, { name: "claude", command: "claude {input}" });
  const s1 = Skills.createSkill(db, { name: "plan", body: "Plan first." });
  const s2 = Skills.createSkill(db, { name: "tdd", body: "Test first." });
  const p = Projects.createProject(db, { name: "app", path: "/app" });
  return { ad, s1, s2, p };
}

test("agent keeps skill order, nests projects, and stores model + effort", () => {
  const db = openDb(":memory:");
  const { ad, s1, s2, p } = fixtures(db);

  const a = R.createAgent(db, {
    name: "planner",
    base_instruction: "You plan.",
    adapter_id: ad.id,
    model: "opus",
    effort: "high",
    skill_ids: [s2.id, s1.id],
    project_ids: [p.id],
  });

  const got = R.getAgent(db, a.id)!;
  expect(got.skills.map((s) => s.id)).toEqual([s2.id, s1.id]);
  expect(got.projects.length).toBe(1);
  expect(got.adapter_id).toBe(ad.id);
  expect(got.model).toBe("opus");
  expect(got.effort).toBe("high");
});

test("agent with zero skills and zero projects is valid", () => {
  const db = openDb(":memory:");
  const { ad } = fixtures(db);

  const b = R.createAgent(db, {
    name: "bare",
    base_instruction: "hi",
    adapter_id: ad.id,
    model: "sonnet",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  expect(R.getAgent(db, b.id)!.skills.length).toBe(0);
  expect(R.getAgent(db, b.id)!.projects.length).toBe(0);
});

test("updateAgent replaces skills, model, and effort", () => {
  const db = openDb(":memory:");
  const { ad, s1, s2, p } = fixtures(db);
  const a = R.createAgent(db, {
    name: "planner",
    base_instruction: "You plan.",
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [s1.id],
    project_ids: [],
  });

  R.updateAgent(db, a.id, {
    name: "planner",
    base_instruction: "You plan well.",
    adapter_id: ad.id,
    model: "sonnet",
    effort: "high",
    skill_ids: [s2.id, s1.id],
    project_ids: [p.id],
  });

  const got = R.getAgent(db, a.id)!;
  expect(got.base_instruction).toBe("You plan well.");
  expect(got.model).toBe("sonnet");
  expect(got.effort).toBe("high");
  expect(got.skills.map((s) => s.id)).toEqual([s2.id, s1.id]);
  expect(got.projects.length).toBe(1);
});
