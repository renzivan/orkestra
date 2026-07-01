// Seed the Orkestra DB with a ready-to-run demo so you can click Run immediately.
// Usage: bun run scripts/seed.ts    (respects ORKESTRA_DB, else ~/.orkestra/orkestra.db)
import { openDb } from "../lib/db";
import { createModel, listModels } from "../lib/repos/models";
import { createAgent, listAgents } from "../lib/repos/agents";
import { createFlow, listFlows } from "../lib/repos/flows";
import { createTask } from "../lib/repos/tasks";

const db = openDb();

function modelByName(name: string) {
  return listModels(db).find((m) => m.name === name) ?? null;
}
function agentByName(name: string) {
  return listAgents(db).find((a) => a.name === name) ?? null;
}
function flowByName(name: string) {
  return listFlows(db).find((f) => f.name === name) ?? null;
}

// A model that needs no LLM: prefixes the input so you can see it flow through.
const demo =
  modelByName("demo-echo") ??
  createModel(db, {
    name: "demo-echo",
    command: `bash -c 'printf "demo> "; cat'`,
  });

// A real Claude preset (runs only if the `claude` CLI is installed).
if (!modelByName("claude")) {
  createModel(db, {
    name: "claude",
    command:
      "claude -p --append-system-prompt {system} {projects:--add-dir}",
  });
}

const echoer =
  agentByName("echoer") ??
  createAgent(db, {
    name: "echoer",
    base_instruction: "You repeat the input back.",
    model_id: demo.id,
    skill_ids: [],
    project_ids: [],
  });

const upper =
  agentByName("shouter") ??
  createAgent(db, {
    name: "shouter",
    base_instruction: "You shout.",
    model_id: modelByName("shout")?.id ??
      createModel(db, {
        name: "shout",
        command: `bash -c 'tr "[:lower:]" "[:upper:]"'`,
      }).id,
    skill_ids: [],
    project_ids: [],
  });

const flow =
  flowByName("demo-flow") ??
  createFlow(db, { name: "demo-flow", agent_ids: [echoer.id, upper.id] });

createTask(db, {
  title: "Demo: echo then shout",
  body: "hello from orkestra",
  target_type: "flow",
  target_id: flow.id,
});

console.log("Seeded demo model, agents, flow, and a task. Open /tasks and click Run.");
