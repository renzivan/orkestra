"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import type { RunWithSteps } from "@/lib/repos/runs";
import type { TranscriptEntry } from "@/lib/engine/transcript";
import { runTaskAction } from "../../actions";

interface StepView {
  position: number;
  agent_name: string;
  entries: TranscriptEntry[];
  status: string;
  exit_code: number | null;
}

function parseTranscript(json: string): TranscriptEntry[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as TranscriptEntry[]) : [];
  } catch {
    return [];
  }
}

export function RunView({
  task,
  initialRun,
}: {
  task: Task;
  initialRun: RunWithSteps | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(
    initialRun?.status ?? null,
  );
  const [steps, setSteps] = useState<Record<number, StepView>>(() => {
    const seed: Record<number, StepView> = {};
    for (const s of initialRun?.steps ?? []) {
      seed[s.position] = {
        position: s.position,
        agent_name: s.agent_name,
        entries: parseTranscript(s.transcript),
        status: s.status,
        exit_code: s.exit_code,
      };
    }
    return seed;
  });
  const finalOutput = initialRun?.final_output ?? null;
  const streaming = initialRun?.status === "running";
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!initialRun || initialRun.status !== "running") return;
    // Rebuild purely from the stream (it replays persisted state first).
    setSteps({});
    const es = new EventSource(`/api/runs/${initialRun.id}/stream`);
    esRef.current = es;
    let finished = false;

    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "step") {
        setSteps((prev) =>
          prev[e.position]
            ? prev // idempotent: don't wipe a step we already have
            : {
                ...prev,
                [e.position]: {
                  position: e.position,
                  agent_name: e.agent_name,
                  entries: [],
                  status: "running",
                  exit_code: null,
                },
              },
        );
      } else if (e.type === "transcript") {
        // e.entries is the full current transcript — replace, don't append.
        setSteps((prev) => ({
          ...prev,
          [e.position]: {
            ...prev[e.position],
            entries: e.entries as TranscriptEntry[],
          },
        }));
      } else if (e.type === "step_done") {
        setSteps((prev) => ({
          ...prev,
          [e.position]: {
            ...prev[e.position],
            status: e.status,
            exit_code: e.exit_code,
          },
        }));
      } else if (e.type === "done") {
        finished = true;
        setRunStatus(e.status);
        es.close();
        router.refresh();
      }
    };
    // While the run is active, let EventSource auto-reconnect on a transient
    // drop — the stream replays persisted state and the handlers are idempotent.
    // Only stop trying once we've seen the terminal 'done' event.
    es.onerror = () => {
      if (finished) es.close();
    };

    return () => es.close();
  }, [initialRun, router]);

  async function run() {
    setBusy(true);
    try {
      await runTaskAction(task.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const stepList = Object.values(steps).sort((a, b) => a.position - b.position);

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div>
            <strong>Run</strong>{" "}
            {runStatus ? (
              <span className={`badge ${runStatus}`}>{runStatus}</span>
            ) : (
              <span className="muted">not run yet</span>
            )}
          </div>
          <button
            className="btn primary"
            onClick={run}
            disabled={busy || streaming}
          >
            {streaming ? "Running…" : runStatus ? "Re-run" : "Run"}
          </button>
        </div>
      </div>

      {stepList.length === 0 ? (
        <div className="empty">No steps yet. Click Run to start.</div>
      ) : (
        stepList.map((s) => (
          <div className="card" key={s.position}>
            <div className="row spread">
              <strong>
                <span className="muted mono">{s.position + 1}.</span>{" "}
                {s.agent_name}
              </strong>
              <span className={`badge ${s.status}`}>
                {s.status}
                {s.exit_code != null && s.status === "failed"
                  ? ` (exit ${s.exit_code})`
                  : ""}
              </span>
            </div>
            <Transcript entries={s.entries} running={s.status === "running"} />
          </div>
        ))
      )}

      {runStatus === "succeeded" && finalOutput != null && (
        <div className="card">
          <label>Final output</label>
          <pre className="output">{finalOutput}</pre>
        </div>
      )}
      {runStatus === "failed" && initialRun?.error && (
        <div className="card">
          <label>Error</label>
          <pre className="output">{initialRun.error}</pre>
        </div>
      )}
    </>
  );
}

function Transcript({
  entries,
  running,
}: {
  entries: TranscriptEntry[];
  running: boolean;
}) {
  if (entries.length === 0) {
    return <pre className="output">{running ? "…" : ""}</pre>;
  }
  return (
    <div className="transcript">
      {entries.map((e, i) => (
        <TranscriptRow key={i} entry={e} />
      ))}
    </div>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "thinking") {
    return (
      <div className="tr thinking">
        <span className="tr-icon">✽</span>
        <span className="tr-body">{entry.text}</span>
      </div>
    );
  }
  if (entry.kind === "tool_call") {
    const summary = toolSummary(entry.input);
    return (
      <div className="tr tool">
        <span className="tr-icon">→</span>
        <span className="tr-body">
          <strong>{entry.name}</strong>
          {summary && <span className="muted"> {summary}</span>}
        </span>
      </div>
    );
  }
  if (entry.kind === "tool_result") {
    const text = entry.content.trim();
    if (!text) return null;
    return (
      <div className={`tr result${entry.isError ? " err" : ""}`}>
        <span className="tr-icon">{entry.isError ? "✗" : "↳"}</span>
        <span className="tr-body">{truncate(text, 500)}</span>
      </div>
    );
  }
  // text — the agent's answer
  return (
    <div className="tr text">
      <span className="tr-body">{entry.text}</span>
    </div>
  );
}

// One-line hint for a tool call: the field that best identifies what it's doing.
function toolSummary(input: unknown): string {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const first = [
    o.file_path,
    o.path,
    o.command,
    o.pattern,
    o.query,
    o.url,
    o.description,
    o.prompt,
  ].find((v) => typeof v === "string" && v.length > 0);
  return first ? truncate(String(first), 120) : "";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
