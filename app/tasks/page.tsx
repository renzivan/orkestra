import { db } from "@/lib/db";
import { listTasks } from "@/lib/repos/tasks";
import { listFlows } from "@/lib/repos/flows";
import { listAgents } from "@/lib/repos/agents";
import { getSettings } from "@/lib/repos/settings";
import { taskRunnable, type Runnable } from "@/lib/runnable";
import { TasksClient } from "./tasks-client";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  const database = db();
  const flows = listFlows(database).map((f) => ({ id: f.id, name: f.name }));
  const agents = listAgents(database).map((a) => ({ id: a.id, name: a.name }));
  const prefix = getSettings(database).task_prefix;
  const tasks = listTasks(database);
  const runnable: Record<number, Runnable> = {};
  for (const t of tasks) runnable[t.id] = taskRunnable(database, t);
  return (
    <TasksClient
      tasks={tasks}
      flows={flows}
      agents={agents}
      prefix={prefix}
      runnable={runnable}
    />
  );
}
