import { db } from "@/lib/db";
import { listTasks } from "@/lib/repos/tasks";
import { listFlows } from "@/lib/repos/flows";
import { listAgents, getDefaultAgent } from "@/lib/repos/agents";
import { getSettings } from "@/lib/repos/settings";
import { latestRunUsageByTask } from "@/lib/repos/runs";
import { taskRunnable, type Runnable } from "@/lib/runnable";
import { getActiveSpaceId } from "../active-space";
import { TasksClient } from "./tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const database = db();
  const spaceId = await getActiveSpaceId(database);
  const flows = listFlows(database, spaceId).map((f) => ({ id: f.id, name: f.name }));
  const agents = listAgents(database, spaceId).map((a) => ({ id: a.id, name: a.name }));
  const defaultAgentId = getDefaultAgent(database, spaceId).id;
  const prefix = getSettings(database, spaceId).task_prefix;
  const tasks = listTasks(database, spaceId);
  const runnable: Record<number, Runnable> = {};
  for (const t of tasks) runnable[t.id] = taskRunnable(database, t);
  const usage = latestRunUsageByTask(database, spaceId);
  return (
    <TasksClient
      tasks={tasks}
      flows={flows}
      agents={agents}
      defaultAgentId={defaultAgentId}
      prefix={prefix}
      runnable={runnable}
      usage={usage}
    />
  );
}
