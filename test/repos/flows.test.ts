import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Skills from "../../lib/repos/skills";
import * as Models from "../../lib/repos/models";
import * as Agents from "../../lib/repos/agents";
import * as R from "../../lib/repos/flows";

function twoAgents(db: ReturnType<typeof openDb>) {
  const m = Models.createModel(db, { name: "claude", command: "claude {input}" });
  const a1 = Agents.createAgent(db, {
    name: "a1",
    base_instruction: "one",
    model_id: m.id,
    skill_ids: [],
    project_ids: [],
  });
  const a2 = Agents.createAgent(db, {
    name: "a2",
    base_instruction: "two",
    model_id: m.id,
    skill_ids: [],
    project_ids: [],
  });
  return { a1, a2 };
}

test("flow preserves agent order", () => {
  const db = openDb(":memory:");
  const { a1, a2 } = twoAgents(db);

  const f = R.createFlow(db, { name: "pipe", agent_ids: [a2.id, a1.id] });
  const got = R.getFlow(db, f.id)!;
  expect(got.agents.map((a) => a.id)).toEqual([a2.id, a1.id]);
});

test("updateFlow replaces steps", () => {
  const db = openDb(":memory:");
  const { a1, a2 } = twoAgents(db);
  const f = R.createFlow(db, { name: "pipe", agent_ids: [a1.id] });
  R.updateFlow(db, f.id, { name: "pipe", agent_ids: [a1.id, a2.id] });
  expect(R.getFlow(db, f.id)!.agents.map((a) => a.id)).toEqual([a1.id, a2.id]);
});
