// Sync built-in adapter presets against the CLIs installed on this machine and
// report what's available. Adapters are detected, not entered by hand.
// Usage: bun run scripts/seed.ts   (respects ORKESTRA_DB, else ~/.orkestra/orkestra.db)
import { openDb } from "../lib/db";
import { syncAdapters } from "../lib/adapters/sync";
import { listAdapters } from "../lib/repos/adapters";

const db = openDb();
syncAdapters(db);

const adapters = listAdapters(db).map((a) => a.name);
if (adapters.length === 0) {
  console.log(
    "No adapters available. Install a supported CLI (e.g. `claude`) and re-run.",
  );
} else {
  console.log(`Available adapters: ${adapters.join(", ")}`);
  console.log("Create an agent at /agents, then run a task at /tasks.");
}
