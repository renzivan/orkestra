import { expect, test } from "bun:test";
import { entryFile } from "./support";
import { openDb } from "../lib/db";
import * as Skills from "../lib/repos/skills";
import * as Projects from "../lib/repos/projects";
import * as Adapters from "../lib/repos/adapters";
import * as Agents from "../lib/repos/agents";
import * as Flows from "../lib/repos/flows";
import { referencesTo } from "../lib/refs";

const SPACE = 1; // seeded "ETel" space (migration v12)

function fixtures(db: ReturnType<typeof openDb>) {
  const ad = Adapters.createAdapter(db, { name: "claude", command: "c {input}" });
  const s = Skills.createSkill(db, SPACE, { name: "plan", body: "plan" });
  const p = Projects.createProject(db, SPACE, { name: "app", path: "/app" });
  const a = Agents.createAgent(db, SPACE, {
    name: "agent",
    instructions: entryFile("b"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [s.id],
    project_ids: [p.id],
  });
  const f = Flows.createFlow(db, SPACE, { name: "flow", agent_ids: [a.id] });
  return { ad, s, p, a, f };
}

test("referencesTo reports the users of each entity", () => {
  const db = openDb(":memory:");
  const { ad, s, p, a } = fixtures(db);
  expect(referencesTo(db, "skill", s.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "project", p.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "adapter", ad.id)[0].kind).toBe("agent");
  expect(referencesTo(db, "agent", a.id)[0].kind).toBe("flow");
});

test("deleting a referenced skill/project drops it from the agent", () => {
  const db = openDb(":memory:");
  const { s, p, a } = fixtures(db);

  Skills.deleteSkill(db, s.id);
  Projects.deleteProject(db, p.id);

  const agent = Agents.getAgent(db, a.id)!;
  expect(agent.skills.length).toBe(0);
  expect(agent.projects.length).toBe(0);
});

test("deleting an adapter nulls it out on agents (kept, non-runnable)", () => {
  const db = openDb(":memory:");
  const { ad, a } = fixtures(db);

  Adapters.deleteAdapter(db, ad.id);

  const agent = Agents.getAgent(db, a.id)!;
  expect(agent).not.toBeNull();
  expect(agent.adapter_id).toBeNull();
});

test("deleting an agent drops its flow steps; the flow shrinks", () => {
  const db = openDb(":memory:");
  const { a, f } = fixtures(db);
  const b = Agents.createAgent(db, SPACE, {
    name: "second",
    instructions: entryFile("b"),
    adapter_id: fixturesAdapterId(db),
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  Flows.updateFlow(db, f.id, { name: "flow", agent_ids: [a.id, b.id] });

  Agents.deleteAgent(db, a.id);

  const flow = Flows.getFlow(db, f.id)!;
  expect(flow).not.toBeNull();
  expect(flow.agents.map((x) => x.id)).toEqual([b.id]);
});

// The single adapter created by fixtures — reused to build a second agent.
function fixturesAdapterId(db: ReturnType<typeof openDb>): number {
  return (Adapters.listAdapters(db)[0] as { id: number }).id;
}
