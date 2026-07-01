"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Model } from "@/lib/types";
import { saveModel, deleteModelAction } from "../actions";

const EXAMPLE = "claude -p --append-system-prompt {system} {projects:--add-dir}";

export function ModelsClient({ models }: { models: Model[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Model | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditing(null);
    setName("");
    setCommand("");
    setError("");
  }

  function startEdit(m: Model) {
    setEditing(m);
    setName(m.name);
    setCommand(m.command);
    setError("");
  }

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    if (!command.trim()) return setError("Command template is required.");
    setBusy(true);
    try {
      await saveModel({ id: editing?.id, name: name.trim(), command: command.trim() });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Model) {
    setError("");
    const res = await deleteModelAction(m.id);
    if (!res.ok) return setError(res.error);
    if (editing?.id === m.id) reset();
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Models</h1>
          <p>A command template Orkestra runs. Input is piped to stdin; the result is read from stdout.</p>
        </div>
      </div>

      <div className="card">
        <div className="stack">
          <h3 style={{ margin: 0 }}>{editing ? "Edit model" : "New model"}</h3>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="claude"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Command template</label>
            <textarea
              value={command}
              placeholder={EXAMPLE}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div
            className="muted"
            style={{ fontSize: 13, lineHeight: 1.7 }}
          >
            Placeholders:{" "}
            <code>{"{system}"}</code> base instruction + skills ·{" "}
            <code>{"{input}"}</code> the input (also on stdin) ·{" "}
            <code>{"{projects}"}</code> one token per path ·{" "}
            <code>{"{projects:--flag}"}</code> emits <code>--flag &lt;path&gt;</code> per path.
            <br />
            Example: <code className="mono">{EXAMPLE}</code>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              {editing ? "Save changes" : "Add model"}
            </button>
            {editing && (
              <button className="btn" onClick={reset} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {models.length === 0 ? (
        <div className="empty">No models yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Command</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                  </td>
                  <td className="mono">{m.command}</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn small" onClick={() => startEdit(m)}>
                        Edit
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => remove(m)}
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
