import { expect, test } from "bun:test";
import { openDb } from "../../lib/db";
import * as R from "../../lib/repos/adapters";

test("adapters: create/list/get/update/delete + unique name", () => {
  const db = openDb(":memory:");

  const a = R.createAdapter(db, {
    name: "claude",
    command: "claude -p {model:--model} --append-system-prompt {system}",
  });
  expect(a.id).toBeGreaterThan(0);
  expect(a.command).toContain("{model:--model}");

  expect(R.listAdapters(db).length).toBe(1);

  R.updateAdapter(db, a.id, { name: "claude", command: "claude -p {input}" });
  expect(R.getAdapter(db, a.id)!.command).toBe("claude -p {input}");

  expect(() =>
    R.createAdapter(db, { name: "CLAUDE", command: "x" }),
  ).toThrow();

  R.deleteAdapter(db, a.id);
  expect(R.listAdapters(db).length).toBe(0);
});
