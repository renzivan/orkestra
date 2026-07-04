import { expect, test } from "bun:test";
import { entryFile } from "../support";
import { openDb } from "../../lib/db";
import * as Skills from "../../lib/repos/skills";
import * as Adapters from "../../lib/repos/adapters";
import * as Agents from "../../lib/repos/agents";
import * as R from "../../lib/repos/flows";

const SPACE = 1; // seeded "ETel" space (migration v12)

function twoAgents(db: ReturnType<typeof openDb>) {
  const ad = Adapters.createAdapter(db, { name: "claude", command: "claude {input}" });
  const a1 = Agents.createAgent(db, SPACE, {
    name: "a1",
    instructions: entryFile("one"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const a2 = Agents.createAgent(db, SPACE, {
    name: "a2",
    instructions: entryFile("two"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  return { a1, a2 };
}

test("flow preserves agent order", () => {
  const db = openDb(":memory:");
  const { a1, a2 } = twoAgents(db);

  const f = R.createFlow(db, SPACE, { name: "pipe", agent_ids: [a2.id, a1.id] });
  const got = R.getFlow(db, f.id)!;
  expect(got.agents.map((a) => a.id)).toEqual([a2.id, a1.id]);
});

test("updateFlow replaces steps", () => {
  const db = openDb(":memory:");
  const { a1, a2 } = twoAgents(db);
  const f = R.createFlow(db, SPACE, { name: "pipe", agent_ids: [a1.id] });
  R.updateFlow(db, f.id, { name: "pipe", agent_ids: [a1.id, a2.id] });
  expect(R.getFlow(db, f.id)!.agents.map((a) => a.id)).toEqual([a1.id, a2.id]);
});
