"use client";

import { useState } from "react";
import Link from "next/link";
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
  /** The agent to edit, or null to create a new one. */
  agent: Agent | null;
  adapters: AdapterChoice[];
  skills: Skill[];
  projects: Project[];
}

export function AgentForm({ agent, adapters, skills, projects }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState(agent?.name ?? "");
  const [base, setBase] = useState(agent?.base_instruction ?? "");
  const [adapterId, setAdapterId] = useState<number | null>(
    agent?.adapter_id ?? null,
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [effort, setEffort] = useState(agent?.effort || "off");
  const [skipPerms, setSkipPerms] = useState(agent?.skip_permissions ?? true);
  const [skillIds, setSkillIds] = useState<number[]>(
    agent?.skills.map((s) => s.id) ?? [],
  );
  const [projectIds, setProjectIds] = useState<number[]>(
    agent?.projects.map((p) => p.id) ?? [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedAdapter = adapters.find((a) => a.id === adapterId) ?? null;

  function chooseAdapter(id: number | null) {
    setAdapterId(id);
    const a = adapters.find((x) => x.id === id);
    setModel(a?.models[0]?.value ?? "");
    setEffort(a?.efforts[0] ?? "off");
  }

  function skillName(id: number) {
    return skills.find((s) => s.id === id)?.name ?? `#${id}`;
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
      const row = await saveAgent({
        id: agent?.id,
        name: name.trim(),
        base_instruction: base,
        adapter_id: adapterId,
        model,
        effort,
        skip_permissions: skipPerms,
        skill_ids: skillIds,
        project_ids: projectIds,
      });
      if (agent) {
        router.refresh();
      } else {
        // New agent — jump to its own page.
        router.push(`/agents/${row.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!agent) return;
    if (
      !(await confirm({
        title: "Delete agent",
        message: `Delete "${agent.name}"? This can't be undone.`,
      }))
    )
      return;
    setError("");
    const res = await deleteAgentAction(agent.id);
    if (!res.ok) return setError(res.error);
    router.push("/agents/new");
    router.refresh();
  }

  const availableSkills = skills.filter((s) => !skillIds.includes(s.id));
  const noAdapters = adapters.length === 0;

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <Link href="/tasks" className="muted">
            ← Home
          </Link>
          <h1 style={{ marginTop: 8 }}>{agent ? agent.name : "New agent"}</h1>
          <p>
            Base instruction + optional skills + projects, running on an
            adapter.
          </p>
        </div>
        {agent && (
          <button className="btn small danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
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
            <label className="checkbox">
              <input
                type="checkbox"
                checked={skipPerms}
                onChange={(e) => setSkipPerms(e.target.checked)}
              />
              <span>Skip permission prompts</span>
            </label>
            <div className="muted" style={{ fontSize: 13 }}>
              Agents run non-interactively, so they can’t answer approval
              prompts. Leave on so the agent can edit files and run tools
              (passes <code>--dangerously-skip-permissions</code>). Turn off only
              for read-only agents.
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
                    <button
                      className="btn small danger"
                      onClick={() => removeSkill(id)}
                    >
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
            <button
              className="btn primary"
              onClick={save}
              disabled={busy || noAdapters}
            >
              {agent ? "Save changes" : "Add agent"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
