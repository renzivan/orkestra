import { expect, test } from "bun:test";
import { openDb } from "../lib/db";
import * as Skills from "../lib/repos/skills";
import * as Projects from "../lib/repos/projects";
import * as Models from "../lib/repos/models";
import * as Agents from "../lib/repos/agents";
import * as Flows from "../lib/repos/flows";
import { referencesTo } from "../lib/refs";

test("referencesTo finds users of each entity, and deletes are blocked", () => {
  const db = openDb(":memory:");
  const m = Models.createModel(db, { name: "claude", command: "c {input}" });
  const s = Skills.createSkill(db, { name: "plan", body: "plan" });
  const p = Projects.createProject(db, { name: "app", path: "/app" });
  const a = Agents.createAgent(db, {
    name: "agent",
    base_instruction: "b",
    model_id: m.id,
    skill_ids: [s.id],
    project_ids: [p.id],
  });
  const f = Flows.createFlow(db, { name: "flow", agent_ids: [a.id] });

  expect(referencesTo(db, "skill", s.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "project", p.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "model", m.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "agent", a.id)[0].kind).toBe("flow");

  expect(() => Skills.deleteSkill(db, s.id)).toThrow(/referenced/i);
  expect(() => Projects.deleteProject(db, p.id)).toThrow(/referenced/i);
  expect(() => Models.deleteModel(db, m.id)).toThrow(/referenced/i);
  expect(() => Agents.deleteAgent(db, a.id)).toThrow(/referenced/i);

  // Unreferenced flow can be deleted; then the agent is free.
  Flows.deleteFlow(db, f.id);
  expect(referencesTo(db, "agent", a.id).length).toBe(0);
  expect(() => Agents.deleteAgent(db, a.id)).not.toThrow();
});
