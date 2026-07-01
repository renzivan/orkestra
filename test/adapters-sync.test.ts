import { expect, test } from "bun:test";
import { openDb } from "../lib/db";
import * as Adapters from "../lib/repos/adapters";
import * as Agents from "../lib/repos/agents";
import { syncAdapters } from "../lib/adapters/sync";
import type { AdapterPreset } from "../lib/adapters/presets";

const PRESETS: AdapterPreset[] = [
  {
    name: "claude",
    bin: "claude",
    command: "claude -p {system}",
    models: [
      { value: "opus", label: "Opus 4.8" },
      { value: "sonnet", label: "Sonnet 5" },
    ],
    efforts: ["off", "high"],
  },
  {
    name: "codex",
    bin: "codex",
    command: "codex {input}",
    models: [{ value: "gpt", label: "GPT" }],
    efforts: ["off"],
  },
];

test("only adapters whose bin is installed are created", () => {
  const db = openDb(":memory:");
  syncAdapters(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });

  const names = Adapters.listAdapters(db).map((a) => a.name);
  expect(names).toContain("claude");
  expect(names).not.toContain("codex");
});

test("an adapter installed later is added; command kept up to date", () => {
  const db = openDb(":memory:");
  syncAdapters(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });
  syncAdapters(db, { presets: PRESETS, isInstalled: () => true });

  expect(Adapters.listAdapters(db).map((a) => a.name).sort()).toEqual([
    "claude",
    "codex",
  ]);
});

test("an uninstalled, unreferenced adapter is removed", () => {
  const db = openDb(":memory:");
  syncAdapters(db, { presets: PRESETS, isInstalled: () => true });
  syncAdapters(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });

  expect(Adapters.listAdapters(db).map((a) => a.name)).toEqual(["claude"]);
});

test("an uninstalled but referenced adapter is kept", () => {
  const db = openDb(":memory:");
  syncAdapters(db, { presets: PRESETS, isInstalled: () => true });
  const codex = Adapters.listAdapters(db).find((a) => a.name === "codex")!;
  Agents.createAgent(db, {
    name: "user-of-codex",
    base_instruction: "b",
    adapter_id: codex.id,
    model: "gpt",
    effort: "off",
    skill_ids: [],
    project_ids: [],
  });

  syncAdapters(db, { presets: PRESETS, isInstalled: (bin) => bin === "claude" });
  expect(Adapters.listAdapters(db).map((a) => a.name).sort()).toEqual([
    "claude",
    "codex",
  ]);
});
