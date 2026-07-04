"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Settings, Space } from "@/lib/types";
import { saveSettings, renameSpaceAction, deleteSpaceAction } from "../actions";
import { useConfirm } from "../confirm-dialog";
import { toast } from "../toast";

export function SettingsClient({
  settings,
  spaces,
  activeSpaceId,
}: {
  settings: Settings;
  spaces: Space[];
  activeSpaceId: number;
}) {
  const router = useRouter();
  const [retries, setRetries] = useState(String(settings.retries));
  const [timeout, setTimeout] = useState(String(settings.step_timeout_seconds));
  const [prefix, setPrefix] = useState(settings.task_prefix);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId);

  async function save() {
    const r = Number(retries);
    const t = Number(timeout);
    const p = prefix.trim();
    if (!Number.isInteger(r) || r < 0)
      return setError("Retries must be a non-negative integer.");
    if (!Number.isInteger(t) || t <= 0)
      return setError("Timeout must be a positive integer.");
    if (p.length > 4) return setError("Task prefix must be 4 characters or fewer.");
    setError("");
    setBusy(true);
    try {
      await saveSettings({ retries: r, step_timeout_seconds: t, task_prefix: p });
      setSaved(true);
      toast.success("Settings saved.");
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>
            Run behavior for <strong>{activeSpace?.name ?? "this space"}</strong>.
            Each space keeps its own settings.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="stack">
          <div>
            <label>Retries before failing a step</label>
            <input
              type="number"
              value={retries}
              min={0}
              onChange={(e) => {
                setRetries(e.target.value);
                setSaved(false);
              }}
            />
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              A failed step is retried this many times, then the run stops and the
              task is marked failed.
            </div>
          </div>
          <div>
            <label>Per-step timeout (seconds)</label>
            <input
              type="number"
              value={timeout}
              min={1}
              onChange={(e) => {
                setTimeout(e.target.value);
                setSaved(false);
              }}
            />
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              A step running longer than this is killed and counts as a failure.
            </div>
          </div>
          <div>
            <label>Task prefix</label>
            <input
              type="text"
              value={prefix}
              maxLength={4}
              placeholder="ENG"
              style={{ maxWidth: 160 }}
              onChange={(e) => {
                setPrefix(e.target.value);
                setSaved(false);
              }}
            />
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Short key (≤4 chars) shown before each task, e.g.{" "}
              <code>{(prefix.trim() || "ENG") + "-1"}: run tests</code>. Leave
              blank to show just the title.
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              Save settings
            </button>
            {saved && <span className="muted">Saved.</span>}
          </div>
        </div>
      </div>

      <SpacesCard spaces={spaces} activeSpaceId={activeSpaceId} />
    </>
  );
}

/** Manage spaces: rename any space, delete a space (with its data). Creating and
 *  switching live in the sidebar switcher; this is the durable admin surface. */
function SpacesCard({
  spaces,
  activeSpaceId,
}: {
  spaces: Space[];
  activeSpaceId: number;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Draft names, keyed by space id, so each row's input is independently edited.
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries(spaces.map((s) => [s.id, s.name])),
  );

  async function rename(id: number) {
    const name = (names[id] ?? "").trim();
    if (!name) return setError("Name required.");
    setError("");
    setBusy(true);
    try {
      await renameSpaceAction(id, name);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Space) {
    const ok = await confirm({
      title: `Delete "${s.name}"?`,
      message:
        "This permanently deletes the space and everything in it — its projects, skills, agents, flows, and tasks. This can't be undone.",
      confirmLabel: "Delete space",
    });
    if (!ok) return;
    setError("");
    setBusy(true);
    try {
      const res = await deleteSpaceAction(s.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: "var(--s-4)" }}>
      <div className="stack">
        <div>
          <h2 style={{ margin: 0 }}>Spaces</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Each space is fully isolated. Create and switch spaces from the
            sidebar.
          </p>
        </div>
        {spaces.map((s) => (
          <div key={s.id} className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={names[s.id] ?? ""}
              disabled={busy}
              onChange={(e) =>
                setNames((n) => ({ ...n, [s.id]: e.target.value }))
              }
              style={{ maxWidth: 260 }}
            />
            {s.id === activeSpaceId && <span className="muted">active</span>}
            <button
              className="btn small"
              disabled={busy}
              onClick={() => rename(s.id)}
            >
              Rename
            </button>
            <button
              className="btn small danger"
              disabled={busy || spaces.length <= 1}
              title={
                spaces.length <= 1 ? "Can't delete the last space." : undefined
              }
              onClick={() => remove(s)}
            >
              Delete
            </button>
          </div>
        ))}
        {error && <div className="error">{error}</div>}
      </div>
      {dialog}
    </div>
  );
}
