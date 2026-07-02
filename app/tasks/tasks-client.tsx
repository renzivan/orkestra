"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Task, TargetType, TaskStatus } from "@/lib/types";
import type { Runnable } from "@/lib/runnable";
import { taskLabel } from "@/lib/repos/tasks";
import { createTaskAction, runTaskAction } from "../actions";

interface Named {
  id: number;
  name: string;
}

// Board columns, left → right. These are the literal task statuses the run
// engine produces; there is no manually-set status.
const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "running", label: "Running" },
  { status: "succeeded", label: "Succeeded" },
  { status: "failed", label: "Failed" },
  { status: "stopped", label: "Stopped" },
];

export function TasksClient({
  tasks,
  flows,
  agents,
  prefix,
  runnable,
}: {
  tasks: Task[];
  flows: Named[];
  agents: Named[];
  prefix: string;
  runnable: Record<number, Runnable>;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  // The task currently being dragged (only runnable, non-running cards drag).
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const canCreate = flows.length > 0 || agents.length > 0;

  function targetName(t: Task) {
    const list = t.target_type === "flow" ? flows : agents;
    return list.find((x) => x.id === t.target_id)?.name ?? `#${t.target_id}`;
  }

  // Dropping a card onto Running (or clicking Run) fires a fresh run and jumps
  // to the detail view, where the run streams live — same path as the button.
  async function run(t: Task) {
    setError("");
    const res = await runTaskAction(t.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/tasks/${t.id}`);
  }

  function runById(id: number) {
    const t = tasks.find((x) => x.id === id);
    if (t) void run(t);
  }

  const byStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

  return (
    <div className="board-page">
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>Drag a task onto Running to run it, or open one to watch its output.</p>
        </div>
        <button
          className="btn primary"
          onClick={() => setModalOpen(true)}
          disabled={!canCreate}
          title={canCreate ? undefined : "Create a flow or agent first"}
        >
          + New Task
        </button>
      </div>

      {!canCreate && (
        <div className="card">
          <div className="muted">
            Create a <a href="/flows">flow</a> or <a href="/agents">agent</a> to
            run tasks against.
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {tasks.length === 0 ? (
        <div className="empty">No tasks yet.</div>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={byStatus(col.status)}
              draggingId={draggingId}
              onDropTask={(id) => {
                setDraggingId(null);
                runById(id);
              }}
            >
              {byStatus(col.status).map((t) => {
                const r = runnable[t.id];
                const blocked = r != null && !r.ok;
                return (
                  <TaskCard
                    key={t.id}
                    task={t}
                    label={taskLabel(prefix, t.id, t.title)}
                    target={`${t.target_type}: ${targetName(t)}`}
                    blocked={blocked}
                    reason={blocked ? r.reason : undefined}
                    dragging={draggingId === t.id}
                    onRun={() => run(t)}
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
                );
              })}
            </Column>
          ))}
        </div>
      )}

      {modalOpen && (
        <NewTaskModal
          flows={flows}
          agents={agents}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  draggingId,
  onDropTask,
  children,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  draggingId: number | null;
  onDropTask: (id: number) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // Running is the only column that accepts a drop (running a task). Everything
  // else the engine owns, so a drop there is a no-op / snap-back.
  const acceptsDrop = status === "running" && draggingId != null;

  return (
    <div
      className={`board-col${over && acceptsDrop ? " drop-target" : ""}`}
      onDragOver={(e) => {
        if (!acceptsDrop) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!acceptsDrop) return;
        e.preventDefault();
        // The dragged card lives in a source column, not here — resolve it by id
        // in the parent, which holds the full task list.
        onDropTask(Number(e.dataTransfer.getData("text/plain")));
      }}
    >
      <div className="board-col-head">
        <span className={`board-col-title ${status}`}>{label}</span>
        <span className="board-col-count">{tasks.length}</span>
      </div>
      <div className="board-col-body">{children}</div>
    </div>
  );
}

function TaskCard({
  task,
  label,
  target,
  blocked,
  reason,
  dragging,
  onRun,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  label: string;
  target: string;
  blocked: boolean;
  reason?: string;
  dragging: boolean;
  onRun: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  // A live run can't be re-dragged (use Stop in the detail view); a non-runnable
  // task (deleted target) can't be dragged either.
  const canDrag = task.status !== "running" && !blocked;

  return (
    <div
      className={`task-card${canDrag ? " draggable" : ""}${dragging ? " dragging" : ""}`}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <Link href={`/tasks/${task.id}`} className="task-card-title">
        {label}
      </Link>
      <div className="task-card-target muted mono">{target}</div>
      {blocked && (
        <div className="task-card-reason muted">can’t run: {reason}</div>
      )}
      <div className="task-card-actions">
        <button
          className="btn small primary"
          onClick={onRun}
          disabled={task.status === "running" || blocked}
          title={blocked ? reason : undefined}
        >
          {task.status === "running" ? "Running…" : task.status === "pending" ? "Run" : "Re-run"}
        </button>
        <Link className="btn small" href={`/tasks/${task.id}`}>
          View
        </Link>
      </div>
    </div>
  );
}

function NewTaskModal({
  flows,
  agents,
  onClose,
  onCreated,
}: {
  flows: Named[];
  agents: Named[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("flow");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const options = targetType === "flow" ? flows : agents;

  async function create() {
    if (!title.trim()) return setError("Title is required.");
    if (!targetId) return setError("Pick a target to run.");
    setBusy(true);
    try {
      await createTaskAction({
        title: title.trim(),
        body,
        target_type: targetType,
        target_id: targetId,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h3 style={{ margin: 0 }}>New task</h3>
        <div className="stack">
          <div>
            <label>Title</label>
            <input
              type="text"
              value={title}
              placeholder="Add a login page"
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label>Details (fed as input to the first agent)</label>
            <textarea
              value={body}
              placeholder="Describe the work…"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: "0 0 160px" }}>
              <label>Target type</label>
              <select
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value as TargetType);
                  setTargetId(null);
                }}
              >
                <option value="flow">Flow</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Target</label>
              <select
                value={targetId ?? ""}
                onChange={(e) => setTargetId(Number(e.target.value) || null)}
              >
                <option value="">Select a {targetType}…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
