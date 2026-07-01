"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, Project, Skill } from "@/lib/types";
import { saveAgent, deleteAgentAction } from "../actions";
import { useConfirm } from "../confirm-dialog";

export interface AdapterChoice {
  id: number;
  name: string;
  models: { value: string; label: string }[];
  efforts: string[];
}

interface Props {
  agents: Agent[];
  adapters: AdapterChoice[];
  skills: Skill[];
  projects: Project[];
}

export function AgentsClient({ agents, adapters, skills, projects }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [adapterId, setAdapterId] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("off");
  const [skillIds, setSkillIds] = useState<number[]>([]);
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedAdapter = adapters.find((a) => a.id === adapterId) ?? null;

  function reset() {
    setEditing(null);
    setName("");
    setBase("");
    setAdapterId(null);
    setModel("");
    setEffort("off");
    setSkillIds([]);
    setProjectIds([]);
    setError("");
  }

  function chooseAdapter(id: number | null) {
    setAdapterId(id);
    const a = adapters.find((x) => x.id === id);
    setModel(a?.models[0]?.value ?? "");
    setEffort(a?.efforts[0] ?? "off");
  }

  function startEdit(a: Agent) {
    setEditing(a);
    setName(a.name);
    setBase(a.base_instruction);
    setAdapterId(a.adapter_id);
    setModel(a.model);
    setEffort(a.effort || "off");
    setSkillIds(a.skills.map((s) => s.id));
    setProjectIds(a.projects.map((p) => p.id));
    setError("");
  }

  function skillName(id: number) {
    return skills.find((s) => s.id === id)?.name ?? `#${id}`;
  }
  function adapterName(id: number) {
    return adapters.find((a) => a.id === id)?.name ?? "—";
  }
  function modelLabel(adapterId: number, value: string) {
    const a = adapters.find((x) => x.id === adapterId);
    return a?.models.find((m) => m.value === value)?.label ?? value;
  }

  function addSkill(id: number) {
    if (!skillIds.includes(id)) setSkillIds([...skillIds, id]);
  }
  function removeSkill(id: number) {
    setSkillIds(skillIds.filter((s) => s !== id));
  }
  function move(id: number, dir: -1 | 1) {
    const i = skillIds.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= skillIds.length) return;
    const next = [...skillIds];
    [next[i], next[j]] = [next[j], next[i]];
    setSkillIds(next);
  }
  function toggleProject(id: number) {
    setProjectIds(
      projectIds.includes(id)
        ? projectIds.filter((p) => p !== id)
        : [...projectIds, id],
    );
  }

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (!adapterId) return setError("An adapter is required.");
    if (!model) return setError("A model is required.");
    setBusy(true);
    try {
      await saveAgent({
        id: editing?.id,
        name: name.trim(),
        base_instruction: base,
        adapter_id: adapterId,
        model,
        effort,
        skill_ids: skillIds,
        project_ids: projectIds,
      });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Agent) {
    if (
      !(await confirm({
        title: "Delete agent",
        message: `Delete "${a.name}"? This can't be undone.`,
      }))
    )
      return;
    setError("");
    const res = await deleteAgentAction(a.id);
    if (!res.ok) return setError(res.error);
    if (editing?.id === a.id) reset();
    router.refresh();
  }

  const availableSkills = skills.filter((s) => !skillIds.includes(s.id));
  const noAdapters = adapters.length === 0;

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p>Base instruction + optional skills + projects, running on an adapter.</p>
        </div>
      </div>

      {noAdapters && (
        <div className="card">
          <div className="muted">
            No adapter available. Adapters are detected from installed CLIs —
            install the <code>claude</code> CLI (on your PATH), then reload.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>{editing ? "Edit agent" : "New agent"}</h3>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="planner"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Base instruction (its core behavior)</label>
            <textarea
              value={base}
              placeholder="You are a careful planner…"
              onChange={(e) => setBase(e.target.value)}
            />
          </div>

          <div className="row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <label>Adapter</label>
              <select
                value={adapterId ?? ""}
                onChange={(e) => chooseAdapter(Number(e.target.value) || null)}
              >
                <option value="">Select an adapter…</option>
                {adapters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Model</label>
              <select
                value={model}
                disabled={!selectedAdapter}
                onChange={(e) => setModel(e.target.value)}
              >
                {(selectedAdapter?.models ?? []).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Thinking effort</label>
              <select
                value={effort}
                disabled={!selectedAdapter}
                onChange={(e) => setEffort(e.target.value)}
              >
                {(selectedAdapter?.efforts ?? ["off"]).map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label>Skills (ordered — applied after base instruction)</label>
            {skillIds.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>
                None. This agent runs on its base instruction alone.
              </div>
            )}
            <div className="stack" style={{ gap: 6 }}>
              {skillIds.map((id, i) => (
                <div key={id} className="row spread" style={{ gap: 8 }}>
                  <span>
                    <span className="muted mono">{i + 1}.</span> {skillName(id)}
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn small"
                      onClick={() => move(id, -1)}
                      disabled={i === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="btn small"
                      onClick={() => move(id, 1)}
                      disabled={i === skillIds.length - 1}
                    >
                      ↓
                    </button>
                    <button className="btn small danger" onClick={() => removeSkill(id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {availableSkills.length > 0 && (
              <select
                value=""
                style={{ marginTop: 8 }}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v) addSkill(v);
                }}
              >
                <option value="">+ Add a skill…</option>
                {availableSkills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label>Projects</label>
            {projects.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No projects defined.
              </div>
            ) : (
              <div className="chips">
                {projects.map((p) => (
                  <label
                    key={p.id}
                    className="chip"
                    style={{ cursor: "pointer", userSelect: "none" }}
                  >
                    <input
                      type="checkbox"
                      checked={projectIds.includes(p.id)}
                      onChange={() => toggleProject(p.id)}
                      style={{ width: "auto", marginRight: 6 }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy || noAdapters}>
              {editing ? "Save changes" : "Add agent"}
            </button>
            {editing && (
              <button className="btn" onClick={reset} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="empty">No agents yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Adapter · Model · Effort</th>
                <th>Skills</th>
                <th>Projects</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                  </td>
                  <td className="muted">
                    {adapterName(a.adapter_id)} · {modelLabel(a.adapter_id, a.model)}
                    {a.effort && a.effort !== "off" ? ` · ${a.effort}` : ""}
                  </td>
                  <td className="muted">
                    {a.skills.map((s) => s.name).join(", ") || "—"}
                  </td>
                  <td className="muted">
                    {a.projects.map((p) => p.name).join(", ") || "—"}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => startEdit(a)}>
                        Edit
                      </button>
                      <button className="btn small danger" onClick={() => remove(a)}>
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
