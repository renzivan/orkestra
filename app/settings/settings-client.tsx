"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/types";
import { saveSettings } from "../actions";
import { toast } from "../toast";

export function SettingsClient({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [retries, setRetries] = useState(String(settings.retries));
  const [timeout, setTimeout] = useState(String(settings.step_timeout_seconds));
  const [prefix, setPrefix] = useState(settings.task_prefix);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

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
          <p>Global run behavior.</p>
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
    </>
  );
}
