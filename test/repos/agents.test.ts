import { expect, test } from "bun:test";
import { entryFile } from "../support";
import { openDb } from "../../lib/db";
import * as Skills from "../../lib/repos/skills";
import * as Projects from "../../lib/repos/projects";
import * as Adapters from "../../lib/repos/adapters";
import * as R from "../../lib/repos/agents";

const SPACE = 1; // seeded "ETel" space (migration v12)

function fixtures(db: ReturnType<typeof openDb>) {
  const ad = Adapters.createAdapter(db, { name: "claude", command: "claude {input}" });
  const s1 = Skills.createSkill(db, SPACE, { name: "plan", body: "Plan first." });
  const s2 = Skills.createSkill(db, SPACE, { name: "tdd", body: "Test first." });
  const p = Projects.createProject(db, SPACE, { name: "app", path: "/app" });
  return { ad, s1, s2, p };
}

test("agent keeps skill order, nests projects, and stores model + effort", () => {
  const db = openDb(":memory:");
  const { ad, s1, s2, p } = fixtures(db);

  const a = R.createAgent(db, SPACE, {
    name: "planner",
    instructions: entryFile("You plan."),
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

  const b = R.createAgent(db, SPACE, {
    name: "bare",
    instructions: entryFile("hi"),
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
  const a = R.createAgent(db, SPACE, {
    name: "planner",
    instructions: entryFile("You plan."),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [s1.id],
    project_ids: [],
  });

  R.updateAgent(db, a.id, {
    name: "planner",
    instructions: entryFile("You plan well."),
    adapter_id: ad.id,
    model: "sonnet",
    effort: "high",
    skill_ids: [s2.id, s1.id],
    project_ids: [p.id],
  });

  const got = R.getAgent(db, a.id)!;
  expect(got.instructions.map((i) => i.body)).toEqual(["You plan well."]);
  expect(got.model).toBe("sonnet");
  expect(got.effort).toBe("high");
  expect(got.skills.map((s) => s.id)).toEqual([s2.id, s1.id]);
  expect(got.projects.length).toBe(1);
});

test("multiple instruction files keep order, entry flag, and position", () => {
  const db = openDb(":memory:");
  const { ad } = fixtures(db);
  const a = R.createAgent(db, SPACE, {
    name: "ceo",
    instructions: [
      { name: "AGENTS.md", body: "identity", is_entry: true },
      { name: "SOUL.md", body: "persona", is_entry: false },
      { name: "TOOLS.md", body: "tools", is_entry: false },
    ],
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const got = R.getAgent(db, a.id)!;
  expect(got.instructions.map((i) => i.name)).toEqual([
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
  ]);
  expect(got.instructions.map((i) => i.position)).toEqual([0, 1, 2]);
  expect(got.instructions.filter((i) => i.is_entry).map((i) => i.name)).toEqual([
    "AGENTS.md",
  ]);
});

test("instruction files cascade-delete with their agent", () => {
  const db = openDb(":memory:");
  const { ad } = fixtures(db);
  const a = R.createAgent(db, SPACE, {
    name: "temp",
    instructions: entryFile("bye"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  R.deleteAgent(db, a.id);
  const n = (
    db
      .query("SELECT COUNT(*) AS n FROM agent_instructions WHERE agent_id = ?")
      .get(a.id) as { n: number }
  ).n;
  expect(n).toBe(0);
});

test("invalid instruction sets are rejected", () => {
  const db = openDb(":memory:");
  const { ad } = fixtures(db);
  const base = {
    name: "x",
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  };
  // zero files
  expect(() => R.createAgent(db, SPACE, { ...base, instructions: [] })).toThrow(
    /at least one instruction file/i,
  );
  // zero entries
  expect(() =>
    R.createAgent(db, SPACE, {
      ...base,
      instructions: [{ name: "AGENTS.md", body: "a", is_entry: false }],
    }),
  ).toThrow(/exactly one/i);
  // two entries
  expect(() =>
    R.createAgent(db, SPACE, {
      ...base,
      instructions: [
        { name: "AGENTS.md", body: "a", is_entry: true },
        { name: "SOUL.md", body: "b", is_entry: true },
      ],
    }),
  ).toThrow(/exactly one/i);
  // duplicate names
  expect(() =>
    R.createAgent(db, SPACE, {
      ...base,
      instructions: [
        { name: "AGENTS.md", body: "a", is_entry: true },
        { name: "AGENTS.md", body: "b", is_entry: false },
      ],
    }),
  ).toThrow(/duplicate/i);
  // empty name
  expect(() =>
    R.createAgent(db, SPACE, {
      ...base,
      instructions: [{ name: "  ", body: "a", is_entry: true }],
    }),
  ).toThrow(/needs a name/i);
});
