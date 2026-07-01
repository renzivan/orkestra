import { expect, test } from "bun:test";
import { openDb } from "../lib/db";
import * as Models from "../lib/repos/models";
import * as Agents from "../lib/repos/agents";
import { syncModels } from "../lib/models/sync";
import type { ModelPreset } from "../lib/models/presets";

const PRESETS: ModelPreset[] = [
  { name: "claude", bin: "claude", command: "claude -p {system}" },
  { name: "codex", bin: "codex", command: "codex {input}" },
];

test("only presets whose bin is installed become models", () => {
  const db = openDb(":memory:");
  syncModels(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });

  const names = Models.listModels(db).map((m) => m.name);
  expect(names).toContain("claude");
  expect(names).not.toContain("codex"); // codex not installed
});

test("a preset installed later is added; command kept up to date", () => {
  const db = openDb(":memory:");
  syncModels(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });
  syncModels(db, { presets: PRESETS, isInstalled: () => true });

  const names = Models.listModels(db).map((m) => m.name).sort();
  expect(names).toEqual(["claude", "codex"]);
});

test("an uninstalled, unreferenced model is removed", () => {
  const db = openDb(":memory:");
  syncModels(db, { presets: PRESETS, isInstalled: () => true });
  syncModels(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });

  expect(Models.listModels(db).map((m) => m.name)).toEqual(["claude"]);
});

test("an uninstalled but referenced model is kept", () => {
  const db = openDb(":memory:");
  syncModels(db, { presets: PRESETS, isInstalled: () => true });
  const codex = Models.listModels(db).find((m) => m.name === "codex")!;
  Agents.createAgent(db, {
    name: "user-of-codex",
    base_instruction: "b",
    model_id: codex.id,
    skill_ids: [],
    project_ids: [],
  });

  // codex now uninstalled but an agent depends on it — must survive.
  syncModels(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });
  expect(Models.listModels(db).map((m) => m.name).sort()).toEqual([
    "claude",
    "codex",
  ]);
});
