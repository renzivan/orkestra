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
