"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { saveProject, deleteProjectAction, pickDirectory } from "../actions";
import { useConfirm } from "../confirm-dialog";

export function ProjectsClient({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditing(null);
    setName("");
    setPath("");
    setError("");
  }

  function startEdit(p: Project) {
    setEditing(p);
    setName(p.name);
    setPath(p.path);
    setError("");
  }

  async function choose() {
    setError("");
    setBusy(true);
    try {
      const { path: picked } = await pickDirectory();
      if (!picked) return; // user cancelled
      setPath(picked);
      // Suggest a name from the folder when the field is empty.
      if (!name.trim()) setName(picked.split("/").filter(Boolean).pop() ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (!path.trim()) return setError("Path is required.");
    setBusy(true);
    try {
      await saveProject({ id: editing?.id, name: name.trim(), path: path.trim() });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    if (
      !(await confirm({
        title: "Delete project",
        message: `Delete "${p.name}"? This can't be undone.`,
      }))
    )
      return;
    setError("");
    const res = await deleteProjectAction(p.id);
    if (!res.ok) return setError(res.error);
    if (editing?.id === p.id) reset();
    router.refresh();
  }

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Local directories an agent can work on. Paths are exposed to its model.</p>
        </div>
      </div>

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>{editing ? "Edit project" : "New project"}</h3>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="myapp"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Path</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="text"
                value={path}
                placeholder="/Users/me/dev/myapp"
                onChange={(e) => setPath(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={choose} disabled={busy}>
                Choose…
              </button>
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              {editing ? "Save changes" : "Add project"}
            </button>
            {editing && (
              <button className="btn" onClick={reset} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty">No projects yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Path</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td className="mono">{p.path}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => startEdit(p)}>
                        Edit
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => remove(p)}
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
