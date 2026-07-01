"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Task, TargetType } from "@/lib/types";
import { createTaskAction, runTaskAction } from "../actions";

interface Named {
  id: number;
  name: string;
}

export function TasksClient({
  tasks,
  flows,
  agents,
}: {
  tasks: Task[];
  flows: Named[];
  agents: Named[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("flow");
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const options = targetType === "flow" ? flows : agents;

  function targetName(t: Task) {
    const list = t.target_type === "flow" ? flows : agents;
    return list.find((x) => x.id === t.target_id)?.name ?? `#${t.target_id}`;
  }

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
      setTitle("");
      setBody("");
      setTargetId(null);
      setError("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(t: Task) {
    await runTaskAction(t.id);
    router.push(`/tasks/${t.id}`);
  }

  const canCreate = flows.length > 0 || agents.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>Describe a task, pick a flow or agent, then run it and watch the output.</p>
        </div>
      </div>

      {!canCreate && (
        <div className="card">
          <div className="muted">
            Create a <a href="/flows">flow</a> or <a href="/agents">agent</a> to
            run tasks against.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>New task</h3>
          <div>
            <label>Title</label>
            <input
              type="text"
              value={title}
              placeholder="Add a login page"
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
          <div>
            <button
              className="btn primary"
              onClick={create}
              disabled={busy || !canCreate}
            >
              Create task
            </button>
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">No tasks yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Target</th>
                <th>Status</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tasks/${t.id}`}>
                      <strong>{t.title}</strong>
                    </Link>
                  </td>
                  <td className="muted">
                    {t.target_type}: {targetName(t)}
                  </td>
                  <td>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        className="btn small primary"
                        onClick={() => run(t)}
                        disabled={t.status === "running"}
                      >
                        {t.status === "running" ? "Running…" : "Run"}
                      </button>
                      <Link className="btn small" href={`/tasks/${t.id}`}>
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
