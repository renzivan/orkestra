import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as R from "../../lib/repos/projects";

test("projects: create/list/get/update/delete + unique name", () => {
  const db = openDb(":memory:");

  const p = R.createProject(db, { name: "myapp", path: "/home/me/app" });
  expect(p.id).toBeGreaterThan(0);
  expect(p.path).toBe("/home/me/app");

  expect(R.listProjects(db).length).toBe(1);

  R.updateProject(db, p.id, { name: "myapp", path: "/home/me/app2" });
  expect(R.getProject(db, p.id)!.path).toBe("/home/me/app2");

  expect(() => R.createProject(db, { name: "MYAPP", path: "/x" })).toThrow();

  R.deleteProject(db, p.id);
  expect(R.listProjects(db).length).toBe(0);
});
