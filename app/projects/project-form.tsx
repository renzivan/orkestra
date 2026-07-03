"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { saveProject, deleteProjectAction, pickDirectory } from "../actions";
import { deleteConfirmMessage } from "../delete-warning";
import { useConfirm } from "../confirm-dialog";
import { toast } from "../toast";

export function ProjectForm({ project }: { project: Project | null }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState(project?.name ?? "");
  const [path, setPath] = useState(project?.path ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      const row = await saveProject({
        id: project?.id,
        name: name.trim(),
        path: path.trim(),
      });
      toast.success(project ? "Project saved." : "Project created.");
      if (project) router.refresh();
      else router.push(`/projects/${row.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!project) return;
    const message = await deleteConfirmMessage(
      "project",
      project.id,
      project.name,
    );
    if (!(await confirm({ title: "Delete project", message }))) return;
    setError("");
    const res = await deleteProjectAction(project.id);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    toast.success("Project deleted.");
    router.push("/projects/new");
    router.refresh();
  }

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>{project ? project.name : "New project"}</h1>
          <p>
            Local directories an agent can work on. Paths are exposed to its
            model.
          </p>
        </div>
        {project && (
          <button className="btn small danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      <div className="card">
        <div className="stack">
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
              {project ? "Save changes" : "Add project"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
