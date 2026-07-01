// Sync built-in model presets against the CLIs installed on this machine and
// report what's available. Models are no longer entered by hand.
// Usage: bun run scripts/seed.ts   (respects ORKESTRA_DB, else ~/.orkestra/orkestra.db)
import { openDb } from "../lib/db";
import { syncModels } from "../lib/models/sync";
import { listModels } from "../lib/repos/models";

const db = openDb();
syncModels(db);

const models = listModels(db).map((m) => m.name);
if (models.length === 0) {
  console.log(
    "No models available. Install a supported CLI (e.g. `claude`) and re-run.",
  );
} else {
  console.log(`Available models: ${models.join(", ")}`);
  console.log("Create an agent at /agents, then run a task at /tasks.");
}
