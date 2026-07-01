import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getTask } from "@/lib/repos/tasks";
import { latestRunForTask, getRunWithSteps } from "@/lib/repos/runs";
import { RunView } from "./run-view";

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

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/tasks" className="muted">
            ← Tasks
          </Link>
          <h1 style={{ marginTop: 8 }}>{task.title}</h1>
        </div>
        <span className={`badge ${task.status}`}>{task.status}</span>
      </div>

      {task.body && (
        <div className="card">
          <label>Input</label>
          <pre className="output">{task.body}</pre>
        </div>
      )}

      <RunView task={task} initialRun={run} />
    </>
  );
}
