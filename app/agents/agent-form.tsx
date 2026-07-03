"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Agent, Project, Skill } from "@/lib/types";
import { saveAgent, deleteAgentAction } from "../actions";
import { deleteConfirmMessage } from "../delete-warning";
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

/** One instruction file being edited in the form. Position is the array index;
 *  exactly one draft is the entry. */
interface InstrDraft {
  name: string;
  body: string;
  is_entry: boolean;
}

/** The entry file is pinned to the top of the list — it always composes first,
 *  so it always shows first and can't be reordered. */
function entryFirst(files: InstrDraft[]): InstrDraft[] {
  return [...files].sort((a, b) => Number(b.is_entry) - Number(a.is_entry));
}

/** A fresh agent starts with a single empty ENTRY file, mirroring the old empty
 *  base instruction. */
function initialInstructions(agent: Agent | null): InstrDraft[] {
  if (agent && agent.instructions.length > 0) {
    return entryFirst(
      agent.instructions.map((i) => ({
        name: i.name,
        body: i.body,
        is_entry: i.is_entry,
      })),
    );
  }
  return [{ name: "AGENTS.md", body: "", is_entry: true }];
}

function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

function formatSize(n: number): string {
  if (n < 1000) return `${n}B`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
}

export function AgentForm({ agent, adapters, skills, projects }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  // The built-in Default agent: its name is locked, it can't be deleted, and it
  // is scoped to all projects (no per-project picker).
  const isDefault = agent?.is_default ?? false;
  const [name, setName] = useState(agent?.name ?? "");
  const [instructions, setInstructions] = useState<InstrDraft[]>(() =>
    initialInstructions(agent),
  );
  const [selected, setSelected] = useState(0);
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
  const [tab, setTab] = useState<"general" | "instructions" | "skills">(
    "general",
  );

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

  // ---- instruction files ----
  function patchInstruction(i: number, patch: Partial<InstrDraft>) {
    setInstructions((prev) =>
      prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    );
  }
  function addFile() {
    let n = 1;
    let fileName = "NOTES.md";
    while (instructions.some((f) => f.name === fileName)) {
      n += 1;
      fileName = `NOTES${n}.md`;
    }
    setInstructions((prev) => [
      ...prev,
      { name: fileName, body: "", is_entry: false },
    ]);
    setSelected(instructions.length);
  }
  function removeFile(i: number) {
    // The entry file can't be deleted — reassign entry first.
    if (instructions[i].is_entry) return;
    setInstructions((prev) => prev.filter((_, idx) => idx !== i));
    setSelected((s) => (s >= i && s > 0 ? s - 1 : s));
  }
  function moveFile(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= instructions.length) return;
    // The entry file is pinned at index 0: never move it, and never let another
    // file swap into the top slot.
    if (i === 0 || j === 0) return;
    setInstructions((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    // Keep the selection pointing at the same file after the swap.
    if (selected === i) setSelected(j);
    else if (selected === j) setSelected(i);
  }
  // Surface a validation error on the tab that owns the offending field, so the
  // input the message refers to is actually visible.
  function fail(message: string, onTab: typeof tab) {
    setTab(onTab);
    setError(message);
  }

  async function save() {
    if (!name.trim()) return fail("Name is required.", "general");
    if (!adapterId) return fail("An adapter is required.", "general");
    if (!model) return fail("A model is required.", "general");
    const names = instructions.map((f) => f.name.trim());
    if (names.some((n) => n.length === 0)) {
      return fail("Every instruction file needs a name.", "instructions");
    }
    if (new Set(names).size !== names.length) {
      return fail("Instruction file names must be unique.", "instructions");
    }
    setBusy(true);
    try {
      const row = await saveAgent({
        id: agent?.id,
        name: name.trim(),
        instructions: instructions.map((f) => ({
          name: f.name.trim(),
          body: f.body,
          is_entry: f.is_entry,
        })),
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
    const message = await deleteConfirmMessage("agent", agent.id, agent.name);
    if (!(await confirm({ title: "Delete agent", message }))) return;
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
          <h1>{agent ? agent.name : "New agent"}</h1>
          <p>
            Instruction files + optional skills + projects, running on an
            adapter.
          </p>
        </div>
        {agent && !isDefault && (
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

      <div className="tabs">
        <button
          className={tab === "general" ? "tab active" : "tab"}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          className={tab === "instructions" ? "tab active" : "tab"}
          onClick={() => setTab("instructions")}
        >
          Instructions
        </button>
        <button
          className={tab === "skills" ? "tab active" : "tab"}
          onClick={() => setTab("skills")}
        >
          Skills
        </button>
      </div>

      <div className="card">
        <div className="stack">
          {tab === "general" && (
            <>
              <div>
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  placeholder="planner"
                  disabled={isDefault}
                  onChange={(e) => setName(e.target.value)}
                />
                {isDefault && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    The Default agent’s name is fixed. It can’t be deleted and is
                    preselected when you create a task.
                  </div>
                )}
              </div>

              <div className="row" style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <label>Adapter</label>
                  <select
                    value={adapterId ?? ""}
                    onChange={(e) =>
                      chooseAdapter(Number(e.target.value) || null)
                    }
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
                  (passes <code>--dangerously-skip-permissions</code>). Turn off
                  only for read-only agents.
                </div>
              </div>

              <div>
                <label>Projects</label>
                {isDefault ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    All projects. The Default agent is scoped to every project
                    automatically, including ones you add later.
                  </div>
                ) : projects.length === 0 ? (
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
            </>
          )}

          {tab === "instructions" && (
            <div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Named instruction files. <code>AGENTS.md</code> is the entry
                file — it leads; the rest follow in order. All are stitched into
                the agent’s system prompt, each under a{" "}
                <code>#&nbsp;filename</code> heading.
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "232px 1fr",
                  gap: "var(--s-3)",
                  alignItems: "start",
                }}
              >
                {/* Left: the file list */}
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row spread">
                    <label style={{ margin: 0 }}>Files</label>
                    <button
                      className="btn small"
                      type="button"
                      onClick={addFile}
                    >
                      + Add
                    </button>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    {instructions.map((f, i) => (
                      <div
                        key={i}
                        className="row spread"
                        style={{
                          gap: 8,
                          padding: "8px 10px",
                          border: "1px solid var(--line)",
                          borderRadius: "var(--r-md)",
                          cursor: "pointer",
                          minWidth: 0,
                          background:
                            i === selected ? "#f6f4ee" : "var(--panel)",
                          boxShadow:
                            i === selected
                              ? "inset 0 0 0 1px var(--line-strong)"
                              : "none",
                        }}
                        onClick={() => setSelected(i)}
                      >
                        <span
                          className="mono"
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: f.is_entry ? "var(--fg)" : "var(--muted)",
                          }}
                        >
                          {f.name.trim() || "(unnamed)"}
                        </span>
                        {f.is_entry ? (
                          <span
                            className="badge"
                            style={{
                              flex: "none",
                              background: "var(--accent)",
                              borderColor: "var(--line-strong)",
                              color: "var(--accent-ink)",
                            }}
                          >
                            ENTRY
                          </span>
                        ) : (
                          <span
                            className="muted mono"
                            style={{ flex: "none", fontSize: 12 }}
                          >
                            {formatSize(byteSize(f.body))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: the selected file's editor */}
                {instructions[selected] && (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="text"
                        value={instructions[selected].name}
                        placeholder="AGENTS.md"
                        style={{ fontFamily: "var(--mono)", flex: 1 }}
                        onChange={(e) =>
                          patchInstruction(selected, { name: e.target.value })
                        }
                      />
                      {/* The entry file is pinned and undeletable — no controls. */}
                      {!instructions[selected].is_entry && (
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() => moveFile(selected, -1)}
                            disabled={selected === 1}
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            className="btn small"
                            type="button"
                            onClick={() => moveFile(selected, 1)}
                            disabled={selected === instructions.length - 1}
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            className="btn small danger"
                            type="button"
                            onClick={() => removeFile(selected)}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                    <textarea
                      value={instructions[selected].body}
                      placeholder="You are a careful planner…"
                      style={{ minHeight: 220 }}
                      onChange={(e) =>
                        patchInstruction(selected, { body: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "skills" && (
            <div>
              <label>Skills (ordered — applied after the instruction files)</label>
              {skillIds.length === 0 && (
                <div className="muted" style={{ fontSize: 13 }}>
                  None. This agent runs on its instruction files alone.
                </div>
              )}
              <div className="stack" style={{ gap: 6 }}>
                {skillIds.map((id, i) => (
                  <div key={id} className="row spread" style={{ gap: 8 }}>
                    <span>
                      <span className="muted mono">{i + 1}.</span>{" "}
                      {skillName(id)}
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
          )}

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
