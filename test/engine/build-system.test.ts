import { expect, test } from "bun:test";
import { buildSystem } from "../../lib/engine/runner";
import type { Agent, AgentInstruction, Skill } from "../../lib/types";

// A minimal Agent shell — buildSystem only reads instructions + skills.
function agent(
  instructions: Partial<AgentInstruction>[],
  skills: Partial<Skill>[] = [],
): Agent {
  return {
    id: 1,
    name: "a",
    instructions: instructions.map((i, idx) => ({
      id: idx + 1,
      name: i.name ?? `F${idx}.md`,
      body: i.body ?? "",
      position: i.position ?? idx,
      is_entry: i.is_entry ?? false,
    })),
    adapter_id: 1,
    model: "opus",
    effort: "",
    skip_permissions: true,
    is_default: false,
    skills: skills.map((s, idx) => ({
      id: idx + 1,
      name: s.name ?? `s${idx}`,
      body: s.body ?? "",
      created_at: "",
      updated_at: "",
    })),
    projects: [],
    created_at: "",
    updated_at: "",
  };
}

test("entry file leads, others follow in position order, each headed by name", () => {
  const sys = buildSystem(
    agent([
      { name: "SOUL.md", body: "persona", position: 0, is_entry: false },
      { name: "AGENTS.md", body: "identity", position: 1, is_entry: true },
      { name: "TOOLS.md", body: "tools", position: 2, is_entry: false },
    ]),
  );
  expect(sys).toBe(
    "# AGENTS.md\nidentity\n\n# SOUL.md\npersona\n\n# TOOLS.md\ntools",
  );
});

test("empty-bodied files drop out (including an empty entry)", () => {
  const sys = buildSystem(
    agent([
      { name: "AGENTS.md", body: "   ", position: 0, is_entry: true },
      { name: "SOUL.md", body: "persona", position: 1, is_entry: false },
    ]),
  );
  expect(sys).toBe("# SOUL.md\npersona");
});

test("skill bodies follow the instruction files, unheaded", () => {
  const sys = buildSystem(
    agent(
      [{ name: "AGENTS.md", body: "identity", position: 0, is_entry: true }],
      [{ name: "plan", body: "Plan first." }],
    ),
  );
  expect(sys).toBe("# AGENTS.md\nidentity\n\nPlan first.");
});
