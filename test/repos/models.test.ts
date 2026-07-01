import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as R from "../../lib/repos/models";

test("models: create/list/get/update/delete + unique name", () => {
  const db = openDb(":memory:");

  const m = R.createModel(db, {
    name: "claude",
    command: "claude -p --append-system-prompt {system}",
  });
  expect(m.id).toBeGreaterThan(0);
  expect(m.command).toContain("{system}");

  expect(R.listModels(db).length).toBe(1);

  R.updateModel(db, m.id, { name: "claude", command: "claude -p {input}" });
  expect(R.getModel(db, m.id)!.command).toBe("claude -p {input}");

  expect(() =>
    R.createModel(db, { name: "CLAUDE", command: "x" }),
  ).toThrow();

  R.deleteModel(db, m.id);
  expect(R.listModels(db).length).toBe(0);
});
