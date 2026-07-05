import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as Tasks from "../../lib/repos/tasks";
import * as Runs from "../../lib/repos/runs";
import * as Settings from "../../lib/repos/settings";

const SPACE = 1; // seeded "ETel" space (migration v12)

test("task status transitions", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "Fix bug",
    body: "do it",
    target_type: "agent",
    target_id: 1,
  });
  expect(t.status).toBe("pending");
  Tasks.setTaskStatus(db, t.id, "running");
  expect(Tasks.getTask(db, t.id)!.status).toBe("running");
  expect(Tasks.listTasks(db, SPACE).length).toBe(1);
});

test("run + steps round-trip", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "in",
    target_type: "flow",
    target_id: 1,
  });
  const run = Runs.startRun(db, t.id);
  expect(run.status).toBe("running");

  const stepId = Runs.addRunStep(db, run.id, {
    position: 0,
    agent_id: 1,
    agent_name: "a1",
    input: "in",
  });
  Runs.finishRunStep(db, stepId, {
    output: "out",
    exit_code: 0,
    error: null,
    status: "succeeded",
  });
  Runs.finishRun(db, run.id, {
    status: "succeeded",
    final_output: "out",
    error: null,
  });

  const full = Runs.getRunWithSteps(db, run.id);
  expect(full.status).toBe("succeeded");
  expect(full.steps.length).toBe(1);
  expect(full.steps[0].output).toBe("out");
  expect(Runs.latestRunForTask(db, t.id)!.id).toBe(run.id);
});

test("step usage: setStepUsage persists the four counts on the step", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "in",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db, t.id);
  const stepId = Runs.addRunStep(db, run.id, {
    position: 0,
    agent_id: 1,
    agent_name: "a1",
    input: "in",
  });
  // A fresh step has not reported usage yet.
  expect(Runs.getRunWithSteps(db, run.id).steps[0].input_tokens).toBeNull();

  Runs.setStepUsage(db, stepId, {
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_tokens: 3,
    cache_read_tokens: 4,
  });
  const step = Runs.getRunWithSteps(db, run.id).steps[0];
  expect(step.input_tokens).toBe(10);
  expect(step.output_tokens).toBe(20);
  expect(step.cache_creation_tokens).toBe(3);
  expect(step.cache_read_tokens).toBe(4);
});

test("runUsage: sums each token count across a run's steps", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "in",
    target_type: "flow",
    target_id: 1,
  });
  const run = Runs.startRun(db, t.id);
  const s0 = Runs.addRunStep(db, run.id, { position: 0, agent_id: 1, agent_name: "a1", input: "" });
  const s1 = Runs.addRunStep(db, run.id, { position: 1, agent_id: 2, agent_name: "a2", input: "" });
  Runs.setStepUsage(db, s0, { input_tokens: 10, output_tokens: 20, cache_creation_tokens: 1, cache_read_tokens: 2 });
  Runs.setStepUsage(db, s1, { input_tokens: 5, output_tokens: 7, cache_creation_tokens: 0, cache_read_tokens: 3 });
  expect(Runs.runUsage(db, run.id)).toEqual({
    input_tokens: 15,
    output_tokens: 27,
    cache_creation_tokens: 1,
    cache_read_tokens: 5,
  });
});

test("agentUsage: sums an agent's usage across every run it appears in", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "in",
    target_type: "agent",
    target_id: 7,
  });
  const runA = Runs.startRun(db, t.id);
  const a0 = Runs.addRunStep(db, runA.id, { position: 0, agent_id: 7, agent_name: "a", input: "" });
  Runs.setStepUsage(db, a0, { input_tokens: 100, output_tokens: 200, cache_creation_tokens: 0, cache_read_tokens: 0 });
  const runB = Runs.startRun(db, t.id);
  const b0 = Runs.addRunStep(db, runB.id, { position: 0, agent_id: 7, agent_name: "a", input: "" });
  Runs.setStepUsage(db, b0, { input_tokens: 1, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0 });
  // A different agent's step must not leak into agent 7's total.
  const b1 = Runs.addRunStep(db, runB.id, { position: 1, agent_id: 8, agent_name: "b", input: "" });
  Runs.setStepUsage(db, b1, { input_tokens: 999, output_tokens: 999, cache_creation_tokens: 999, cache_read_tokens: 999 });

  expect(Runs.agentUsage(db, 7)).toEqual({
    input_tokens: 101,
    output_tokens: 202,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  });
});

test("usage reads return null when no step reported usage", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "in",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db, t.id);
  Runs.addRunStep(db, run.id, { position: 0, agent_id: 1, agent_name: "a1", input: "" });
  expect(Runs.runUsage(db, run.id)).toBeNull();
  expect(Runs.agentUsage(db, 1)).toBeNull();
});

test("latestRunUsageByTask: sums the latest run's steps per task, ignoring older runs", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  // An older run whose usage must NOT be counted — only the latest run matters.
  const old = Runs.startRun(db, t.id);
  const os = Runs.addRunStep(db, old.id, { position: 0, agent_id: 1, agent_name: "a", input: "" });
  Runs.setStepUsage(db, os, { input_tokens: 999, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 });
  // The latest run, two steps.
  const run = Runs.startRun(db, t.id);
  const s0 = Runs.addRunStep(db, run.id, { position: 0, agent_id: 1, agent_name: "a", input: "" });
  const s1 = Runs.addRunStep(db, run.id, { position: 1, agent_id: 2, agent_name: "b", input: "" });
  Runs.setStepUsage(db, s0, { input_tokens: 10, output_tokens: 20, cache_creation_tokens: 1, cache_read_tokens: 2 });
  Runs.setStepUsage(db, s1, { input_tokens: 5, output_tokens: 7, cache_creation_tokens: 0, cache_read_tokens: 3 });

  const map = Runs.latestRunUsageByTask(db, SPACE);
  expect(map[t.id]).toEqual({
    input_tokens: 15,
    output_tokens: 27,
    cache_creation_tokens: 1,
    cache_read_tokens: 5,
  });
});

test("latestRunUsageByTask: omits tasks with no reported usage or no run", () => {
  const db = openDb(":memory:");
  const t = Tasks.createTask(db, SPACE, {
    title: "T",
    body: "",
    target_type: "agent",
    target_id: 1,
  });
  const run = Runs.startRun(db, t.id);
  Runs.addRunStep(db, run.id, { position: 0, agent_id: 1, agent_name: "a", input: "" });
  const t2 = Tasks.createTask(db, SPACE, {
    title: "T2",
    body: "",
    target_type: "agent",
    target_id: 1,
  });

  const map = Runs.latestRunUsageByTask(db, SPACE);
  expect(map[t.id]).toBeUndefined(); // ran, but reported no usage
  expect(map[t2.id]).toBeUndefined(); // never ran
});

test("settings get/update", () => {
  const db = openDb(":memory:");
  expect(Settings.getSettings(db, SPACE)).toEqual({
    retries: 1,
    step_timeout_seconds: 600,
    task_prefix: "",
  });
  Settings.updateSettings(db, SPACE, { retries: 3, step_timeout_seconds: 120 });
  expect(Settings.getSettings(db, SPACE)).toEqual({
    retries: 3,
    step_timeout_seconds: 120,
    task_prefix: "",
  });
  Settings.updateSettings(db, SPACE, { task_prefix: "ENG" });
  expect(Settings.getSettings(db, SPACE).task_prefix).toBe("ENG");
});

test("taskLabel formats with prefix, falls back to title", () => {
  expect(Tasks.taskLabel("ENG", 1, "run tests")).toBe("ENG-1: run tests");
  expect(Tasks.taskLabel("", 1, "run tests")).toBe("run tests");
});
