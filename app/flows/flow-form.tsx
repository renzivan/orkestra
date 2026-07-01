"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, Flow } from "@/lib/types";
import { saveFlow, deleteFlowAction } from "../actions";
import { useConfirm } from "../confirm-dialog";

interface Props {
  flow: Flow | null;
  agents: Agent[];
}

export function FlowForm({ flow, agents }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState(flow?.name ?? "");
  const [agentIds, setAgentIds] = useState<number[]>(
    flow?.agents.map((a) => a.id) ?? [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      const row = await saveFlow({
        id: flow?.id,
        name: name.trim(),
        agent_ids: agentIds,
      });
      if (flow) router.refresh();
      else router.push(`/flows/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!flow) return;
    if (
      !(await confirm({
        title: "Delete flow",
        message: `Delete "${flow.name}"? This can't be undone.`,
      }))
    )
      return;
    setError("");
    const res = await deleteFlowAction(flow.id);
    if (!res.ok) return setError(res.error);
    router.push("/flows/new");
    router.refresh();
  }

  const noAgents = agents.length === 0;

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>{flow ? flow.name : "New flow"}</h1>
          <p>An ordered pipeline of agents. Each agent&apos;s output feeds the next.</p>
        </div>
        {flow && (
          <button className="btn small danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      {noAgents && (
        <div className="card">
          <div className="muted">
            Create an <a href="/agents/new">agent</a> first — a flow is made of
            agents.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stack">
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
            <button
              className="btn primary"
              onClick={save}
              disabled={busy || noAgents}
            >
              {flow ? "Save changes" : "Add flow"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
