"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/types";
import { saveSettings } from "../actions";

export function SettingsClient({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [retries, setRetries] = useState(String(settings.retries));
  const [timeout, setTimeout] = useState(String(settings.step_timeout_seconds));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    const r = Number(retries);
    const t = Number(timeout);
    if (!Number.isInteger(r) || r < 0)
      return setError("Retries must be a non-negative integer.");
    if (!Number.isInteger(t) || t <= 0)
      return setError("Timeout must be a positive integer.");
    setError("");
    setBusy(true);
    try {
      await saveSettings({ retries: r, step_timeout_seconds: t });
      setSaved(true);
      router.refresh();
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
