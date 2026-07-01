"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, Flow } from "@/lib/types";
import { saveFlow, deleteFlowAction } from "../actions";

export function FlowsClient({
  flows,
  agents,
}: {
  flows: Flow[];
  agents: Agent[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Flow | null>(null);
  const [name, setName] = useState("");
  const [agentIds, setAgentIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditing(null);
    setName("");
    setAgentIds([]);
    setError("");
  }

  function startEdit(f: Flow) {
    setEditing(f);
    setName(f.name);
    setAgentIds(f.agents.map((a) => a.id));
    setError("");
  }

  function agentName(id: number) {
    return agents.find((a) => a.id === id)?.name ?? `#${id}`;
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= agentIds.length) return;
    const next = [...agentIds];
    [next[i], next[j]] = [next[j], next[i]];
    setAgentIds(next);
  }

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (agentIds.length === 0) return setError("Add at least one agent.");
    setBusy(true);
    try {
      await saveFlow({ id: editing?.id, name: name.trim(), agent_ids: agentIds });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: Flow) {
    setError("");
    const res = await deleteFlowAction(f.id);
    if (!res.ok) return setError(res.error);
    if (editing?.id === f.id) reset();
    router.refresh();
  }

  const noAgents = agents.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Flows</h1>
          <p>An ordered pipeline of agents. Each agent&apos;s output feeds the next.</p>
        </div>
      </div>

      {noAgents && (
        <div className="card">
          <div className="muted">
            Create an <a href="/agents">agent</a> first — a flow is made of agents.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>{editing ? "Edit flow" : "New flow"}</h3>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="review-pipeline"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Steps (run top to bottom)</label>
            {agentIds.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                No steps yet.
              </div>
            )}
            <div className="stack" style={{ gap: 6 }}>
              {agentIds.map((id, i) => (
                <div key={`${id}-${i}`} className="row spread" style={{ gap: 8 }}>
                  <span>
                    <span className="muted mono">{i + 1}.</span> {agentName(id)}
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn small"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="btn small"
                      onClick={() => move(i, 1)}
                      disabled={i === agentIds.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() =>
                        setAgentIds(agentIds.filter((_, k) => k !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!noAgents && (
              <select
                value=""
                style={{ marginTop: 8 }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v) setAgentIds([...agentIds, v]);
                }}
              >
                <option value="">+ Add an agent step…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy || noAgents}>
              {editing ? "Save changes" : "Add flow"}
            </button>
            {editing && (
              <button className="btn" onClick={reset} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {flows.length === 0 ? (
        <div className="empty">No flows yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Pipeline</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong>{f.name}</strong>
                  </td>
                  <td className="muted">
                    {f.agents.map((a) => a.name).join(" → ") || "—"}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => startEdit(f)}>
                        Edit
                      </button>
                      <button className="btn small danger" onClick={() => remove(f)}>
                        Delete
                      </button>
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
