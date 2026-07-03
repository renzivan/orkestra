"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Task, TargetType, TaskStatus } from "@/lib/types";
import type { Runnable } from "@/lib/runnable";
import { taskLabel, taskDeleteMessage, isTaskUnread } from "@/lib/repos/tasks";
import { createTaskAction, runTaskAction, deleteTaskAction } from "../actions";
import { useConfirm } from "../confirm-dialog";

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
  defaultAgentId,
  prefix,
  runnable,
}: {
  tasks: Task[];
  flows: Named[];
  agents: Named[];
  /** Preselected target when creating a task — the built-in Default agent. */
  defaultAgentId: number;
  prefix: string;
  runnable: Record<number, Runnable>;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  // The task currently being dragged (only runnable, non-running cards drag).
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // The task currently mid-delete, so its card can show a busy state.
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canCreate = flows.length > 0 || agents.length > 0;

  // The board (and the sidebar unread badge) are server-rendered per request, so
  // a run starting or settling in the background won't move its card or bump the
  // badge on its own. Subscribe to the tasks topic; each nudge triggers a
  // router.refresh(), which re-renders both the board and the layout. Deps are
  // just [router], so a refresh doesn't tear the connection down.
  useEffect(() => {
    const es = new EventSource("/api/tasks/stream");
    es.onmessage = () => router.refresh();
    return () => es.close();
  }, [router]);

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

  async function remove(t: Task) {
    setError("");
    const message = taskDeleteMessage(
      taskLabel(prefix, t.id, t.title),
      t.status === "running",
    );
    if (!(await confirm({ title: "Delete task", message }))) return;
    setDeletingId(t.id);
    try {
      const res = await deleteTaskAction(t.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  const byStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

  return (
    <div className="board-page">
      {dialog}
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
                    unread={isTaskUnread(t)}
                    blocked={blocked}
                    reason={blocked ? r.reason : undefined}
                    dragging={draggingId === t.id}
                    deleting={deletingId === t.id}
                    onRun={() => run(t)}
                    onDelete={() => remove(t)}
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
          defaultAgentId={defaultAgentId}
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
  unread,
  blocked,
  reason,
  dragging,
  deleting,
  onRun,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  label: string;
  target: string;
  /** Settled since last opened — flag it so the user sees which card the badge
   *  is counting. Cleared when the task's detail is opened. */
  unread: boolean;
  blocked: boolean;
  reason?: string;
  dragging: boolean;
  deleting: boolean;
  onRun: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  // A live run can't be re-dragged (use Stop in the detail view); a non-runnable
  // task (deleted target) can't be dragged either.
  const canDrag = task.status !== "running" && !blocked;

  return (
    <div
      className={`task-card${canDrag ? " draggable" : ""}${dragging ? " dragging" : ""}${unread ? " unread" : ""}`}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {unread && <span className="task-card-dot" aria-label="Needs attention" />}
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
        <button className="btn small danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function NewTaskModal({
  flows,
  agents,
  defaultAgentId,
  onClose,
  onCreated,
}: {
  flows: Named[];
  agents: Named[];
  defaultAgentId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Preselect the Default agent so a task can be created with no target fiddling.
  const [targetType, setTargetType] = useState<TargetType>("agent");
  const [targetId, setTargetId] = useState<number | null>(defaultAgentId);
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
                  const next = e.target.value as TargetType;
                  setTargetType(next);
                  // Land on a valid option immediately — the Default agent for
                  // agents, the first flow otherwise — so there's no empty state.
                  setTargetId(next === "agent" ? defaultAgentId : flows[0]?.id ?? null);
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
