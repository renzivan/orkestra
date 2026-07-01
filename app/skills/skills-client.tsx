"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@/lib/types";
import { saveSkill, deleteSkillAction } from "../actions";
import { useConfirm } from "../confirm-dialog";

export function SkillsClient({ skills }: { skills: Skill[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Skill | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditing(null);
    setName("");
    setBody("");
    setError("");
  }

  function startEdit(s: Skill) {
    setEditing(s);
    setName(s.name);
    setBody(s.body);
    setError("");
  }

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    try {
      await saveSkill({ id: editing?.id, name: name.trim(), body });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Skill) {
    if (
      !(await confirm({
        title: "Delete skill",
        message: `Delete "${s.name}"? This can't be undone.`,
      }))
    )
      return;
    setError("");
    const res = await deleteSkillAction(s.id);
    if (!res.ok) return setError(res.error);
    if (editing?.id === s.id) reset();
    router.refresh();
  }

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>Skills</h1>
          <p>Reusable instruction text layered onto an agent&apos;s base instruction.</p>
        </div>
      </div>

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>{editing ? "Edit skill" : "New skill"}</h3>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="write-tests"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Instruction body (markdown)</label>
            <textarea
              value={body}
              placeholder="Always write a failing test first…"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              {editing ? "Save changes" : "Add skill"}
            </button>
            {editing && (
              <button className="btn" onClick={reset} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="empty">No skills yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Body</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td className="muted">
                    {s.body.slice(0, 80) || <em>empty</em>}
                    {s.body.length > 80 ? "…" : ""}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => startEdit(s)}>
                        Edit
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => remove(s)}
                      >
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
