import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as R from "../../lib/repos/skills";

test("create/list/get/update/delete + case-insensitive unique name", () => {
  const db = openDb(":memory:");

  const s = R.createSkill(db, { name: "write-tests", body: "TDD." });
  expect(s.id).toBeGreaterThan(0);
  expect(s.name).toBe("write-tests");
  expect(s.body).toBe("TDD.");

  expect(R.listSkills(db).length).toBe(1);

  R.updateSkill(db, s.id, { name: "write-tests", body: "Test first." });
  expect(R.getSkill(db, s.id)!.body).toBe("Test first.");

  expect(() => R.createSkill(db, { name: "WRITE-TESTS", body: "x" })).toThrow();

  R.deleteSkill(db, s.id);
  expect(R.listSkills(db).length).toBe(0);
  expect(R.getSkill(db, s.id)).toBeNull();
});
