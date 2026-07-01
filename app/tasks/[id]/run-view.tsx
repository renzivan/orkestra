"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import type { RunWithSteps } from "@/lib/repos/runs";
import { runTaskAction } from "../../actions";

interface StepView {
  position: number;
  agent_name: string;
  output: string;
  status: string;
  exit_code: number | null;
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
        output: s.output,
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

    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === "step") {
        setSteps((prev) => ({
          ...prev,
          [e.position]: {
            position: e.position,
            agent_name: e.agent_name,
            output: "",
            status: "running",
            exit_code: null,
          },
        }));
      } else if (e.type === "chunk") {
        setSteps((prev) => ({
          ...prev,
          [e.position]: {
            ...prev[e.position],
            output: (prev[e.position]?.output ?? "") + e.text,
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
        setRunStatus(e.status);
        es.close();
        router.refresh();
      }
    };
    es.onerror = () => es.close();

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
            <pre className="output">{s.output || "…"}</pre>
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
