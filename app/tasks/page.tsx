import { db } from "@/lib/db";
import { listTasks } from "@/lib/repos/tasks";
import { listFlows } from "@/lib/repos/flows";
import { listAgents } from "@/lib/repos/agents";
import { TasksClient } from "./tasks-client";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  const database = db();
  const flows = listFlows(database).map((f) => ({ id: f.id, name: f.name }));
  const agents = listAgents(database).map((a) => ({ id: a.id, name: a.name }));
  return (
    <TasksClient tasks={listTasks(database)} flows={flows} agents={agents} />
  );
}
