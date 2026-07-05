import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getTask, taskLabel } from "@/lib/repos/tasks";
import { latestRunForTask, getRunWithSteps, runUsage } from "@/lib/repos/runs";
import { getSettings } from "@/lib/repos/settings";
import { taskRunnable } from "@/lib/runnable";
import { RunView } from "./run-view";
import { DeleteTaskButton } from "./delete-task-button";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = db();
  const task = getTask(database, Number(id));
  if (!task) notFound();

  const latest = latestRunForTask(database, task.id);
  const run = latest ? getRunWithSteps(database, latest.id) : null;
  const usage = run ? runUsage(database, run.id) : null;
  // Prefix comes from the task's own Space, not the active one — a task detail
  // page can be opened while a different Space is active.
  const prefix = getSettings(database, task.space_id).task_prefix;
  const runnable = taskRunnable(database, task);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/tasks" className="muted">
            ← Tasks
          </Link>
          <h1 style={{ marginTop: 8 }}>
            {taskLabel(prefix, task.id, task.title)}
          </h1>
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className={`badge ${task.status}`}>{task.status}</span>
          <DeleteTaskButton
            task={task}
            label={taskLabel(prefix, task.id, task.title)}
          />
        </div>
      </div>

      <RunView
        task={task}
        initialRun={run}
        initialUsage={usage}
        runnable={runnable}
      />
    </>
  );
}
