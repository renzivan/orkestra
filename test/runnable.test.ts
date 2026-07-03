import { expect, test } from "bun:test";
import { entryFile } from "./support";
import { openDb } from "../lib/db";
import * as Adapters from "../lib/repos/adapters";
import * as Agents from "../lib/repos/agents";
import * as Flows from "../lib/repos/flows";
import * as Tasks from "../lib/repos/tasks";
import { taskRunnable } from "../lib/runnable";

function setup(db: ReturnType<typeof openDb>) {
  const ad = Adapters.createAdapter(db, { name: "claude", command: "c {input}" });
  const a = Agents.createAgent(db, {
    name: "agent",
    instructions: entryFile("b"),
    adapter_id: ad.id,
    model: "opus",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });
  const f = Flows.createFlow(db, { name: "flow", agent_ids: [a.id] });
  return { ad, a, f };
}

function agentTask(db: ReturnType<typeof openDb>, id: number) {
  return Tasks.createTask(db, { title: "t", body: "", target_type: "agent", target_id: id });
}
function flowTask(db: ReturnType<typeof openDb>, id: number) {
  return Tasks.createTask(db, { title: "t", body: "", target_type: "flow", target_id: id });
}

test("a well-formed agent task and flow task are runnable", () => {
  const db = openDb(":memory:");
  const { a, f } = setup(db);
  expect(taskRunnable(db, agentTask(db, a.id)).ok).toBe(true);
  expect(taskRunnable(db, flowTask(db, f.id)).ok).toBe(true);
});

test("deleted target agent is non-runnable", () => {
  const db = openDb(":memory:");
  const { a } = setup(db);
  const task = agentTask(db, a.id);
  Agents.deleteAgent(db, a.id);
  const r = taskRunnable(db, task);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/deleted/);
});

test("agent whose adapter was deleted is non-runnable", () => {
  const db = openDb(":memory:");
  const { ad, a } = setup(db);
  const task = agentTask(db, a.id);
  Adapters.deleteAdapter(db, ad.id);
  const r = taskRunnable(db, task);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/adapter/);
});

test("deleted target flow is non-runnable", () => {
  const db = openDb(":memory:");
  const { f } = setup(db);
  const task = flowTask(db, f.id);
  Flows.deleteFlow(db, f.id);
  expect(taskRunnable(db, task).reason).toMatch(/deleted/);
});

test("flow emptied by deleting its only agent is non-runnable", () => {
  const db = openDb(":memory:");
  const { a, f } = setup(db);
  const task = flowTask(db, f.id);
  Agents.deleteAgent(db, a.id);
  expect(taskRunnable(db, task).reason).toMatch(/no steps/);
});

test("flow with a step agent that lost its adapter is non-runnable", () => {
  const db = openDb(":memory:");
  const { ad, f } = setup(db);
  const task = flowTask(db, f.id);
  Adapters.deleteAdapter(db, ad.id);
  expect(taskRunnable(db, task).reason).toMatch(/adapter/);
});
