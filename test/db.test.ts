import { expect, test } from "bun:test";
import { openDb } from "../lib/db";

test("migrations create tables + settings row", () => {
  const db = openDb(":memory:");
  const names = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  for (const t of [
    "skills",
    "projects",
    "models",
    "agents",
    "agent_skills",
    "agent_projects",
    "flows",
    "flow_steps",
    "tasks",
    "runs",
    "run_steps",
    "settings",
  ]) {
    expect(names).toContain(t);
  }
  const s: any = db.query("SELECT * FROM settings WHERE id=1").get();
  expect(s.retries).toBe(1);
  expect(s.step_timeout_seconds).toBe(600);
});
