"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import type { Runnable } from "@/lib/runnable";
import type { RunWithSteps } from "@/lib/repos/runs";
import type { TranscriptEntry } from "@/lib/engine/transcript";
import {
  runTaskAction,
  replyToRunAction,
  stopRunAction,
  resumeRunAction,
  markTaskSeenAction,
} from "../../actions";

interface StepView {
  position: number;
  agent_name: string;
  input: string;
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

// The agent's answer for a turn = its `text` entries joined.
function answerText(entries: TranscriptEntry[]): string {
  return entries
    .filter((e) => e.kind === "text")
    .map((e) => (e as { text: string }).text)
    .join("");
}

function seedSteps(run: RunWithSteps | null): Record<number, StepView> {
  const seed: Record<number, StepView> = {};
  for (const s of run?.steps ?? []) {
    seed[s.position] = {
      position: s.position,
      agent_name: s.agent_name,
      input: s.input,
      entries: parseTranscript(s.transcript),
      status: s.status,
      exit_code: s.exit_code,
    };
  }
  return seed;
}

export function RunView({
  task,
  initialRun,
  runnable,
}: {
  task: Task;
  initialRun: RunWithSteps | null;
  runnable: Runnable;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Stop has its own disabled flag, kept separate from `busy` (run/resume): a
  // stop stays pending until the run winds down, and reusing `busy` would leave
  // the Re-run/Resume buttons that replace Stop disabled too.
  const [stopping, setStopping] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(
    initialRun?.status ?? null,
  );
  const [steps, setSteps] = useState<Record<number, StepView>>(() =>
    seedSteps(initialRun),
  );
  const streaming = initialRun?.status === "running";
  // Resumable = the last step captured a CLI session id (Claude adapters do).
  // Gated on the server prop, not local state, so it tracks refreshes exactly.
  const lastStep = initialRun?.steps[initialRun.steps.length - 1];
  const canReply =
    initialRun?.status === "succeeded" && !!lastStep?.session_id;
  const failedError =
    initialRun?.status === "failed" ? initialRun.error : null;
  const esRef = useRef<EventSource | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialRun || initialRun.status !== "running") return;
    // Seed from the persisted run (NOT an empty wipe — that would collapse the
    // thread and jerk the scroll to the top on reply). The stream then replays
    // idempotently on top.
    setSteps(seedSteps(initialRun));
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
                  input: e.input,
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
        // The run just settled while we're watching — mark it seen so it doesn't
        // pop back into the unread badge, then refresh (also updates the badge).
        void markTaskSeenAction(task.id).then(() => router.refresh());
      }
    };
    // While the run is active, let EventSource auto-reconnect on a transient
    // drop — the stream replays persisted state and the handlers are idempotent.
    // Only stop trying once we've seen the terminal 'done' event.
    es.onerror = () => {
      if (finished) es.close();
    };

    return () => es.close();
  }, [initialRun, router, task.id]);

  // Opening an already-settled task clears it from the sidebar unread badge. A
  // live run is cleared by the stream's 'done' handler instead, so skip it here
  // to avoid tearing down the EventSource with a refresh mid-stream.
  useEffect(() => {
    if (initialRun?.status === "running") return;
    void markTaskSeenAction(task.id).then(() => router.refresh());
  }, [task.id, initialRun?.status, router]);

  // Follow the stream: while running, keep the newest output in view — but only
  // if the user is already near the bottom, so scrolling up to read isn't yanked.
  // Scroll to the true page bottom (scrollHeight), not a sentinel, so no strip
  // of padding is left below.
  useEffect(() => {
    if (!streaming) return;
    const el = document.scrollingElement ?? document.documentElement;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [steps, streaming]);

  // Once the run leaves 'running' (the Stop button is gone), clear the pending
  // stop flag so a later run's Stop starts enabled again.
  useEffect(() => {
    if (!streaming) setStopping(false);
  }, [streaming]);

  async function run() {
    setBusy(true);
    try {
      await runTaskAction(task.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reply(text: string) {
    if (!initialRun) return;
    await replyToRunAction(initialRun.id, text);
    router.refresh();
  }

  async function stopRun() {
    if (!initialRun) return;
    setStopping(true);
    // Stay disabled ("Stopping…") until the run actually winds down: stopRunAction
    // only fires SIGTERM and returns immediately, so clearing this here would
    // re-enable "Stop" for a beat before the SSE 'done' flips the view to the
    // stopped state — that flash reads as a glitch. The effect below resets it
    // once the run leaves 'running'; only clear early if the request itself fails.
    try {
      await stopRunAction(initialRun.id);
    } catch {
      setStopping(false);
    }
  }

  async function resume() {
    if (!initialRun) return;
    setBusy(true);
    try {
      await resumeRunAction(initialRun.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const stepList = Object.values(steps).sort((a, b) => a.position - b.position);
  const multiAgent =
    new Set(stepList.map((s) => s.agent_name)).size > 1;

  // A deleted target (agent/flow) or a missing adapter makes the task
  // non-runnable — disable the run controls and say why, rather than letting a
  // click fail mid-run. Stop is never gated (it acts on the live process).
  const blocked = !runnable.ok;

  return (
    <div className="card chat">
      <div className="row spread chat-head">
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          {runStatus ? (
            <span className={`badge ${runStatus}`}>{runStatus}</span>
          ) : (
            <span className="muted">not run yet</span>
          )}
          {blocked && !streaming && (
            <span className="muted mono" style={{ fontSize: 12 }}>
              can’t run: {runnable.reason}
            </span>
          )}
        </div>
        {streaming ? (
          <button className="btn danger" onClick={stopRun} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : runStatus === "stopped" ? (
          <div className="row">
            <button
              className="btn"
              onClick={run}
              disabled={busy || blocked}
              title={blocked ? runnable.reason : undefined}
            >
              Re-run
            </button>
            <button
              className="btn primary"
              onClick={resume}
              disabled={busy || blocked}
              title={blocked ? runnable.reason : undefined}
            >
              Resume
            </button>
          </div>
        ) : (
          <button
            className="btn primary"
            onClick={run}
            disabled={busy || blocked}
            title={blocked ? runnable.reason : undefined}
          >
            {runStatus ? "Re-run" : "Run"}
          </button>
        )}
      </div>

      {task.body && <Msg role="user">{task.body}</Msg>}

      {stepList.map((s, i) => {
        // A step whose input isn't the previous turn's answer is a user reply
        // (vs a flow handing one agent's output to the next).
        const prev = i > 0 ? stepList[i - 1] : null;
        const isReply = prev != null && s.input !== answerText(prev.entries);
        return (
          <div key={s.position} className="turn">
            {isReply && <Msg role="user">{s.input}</Msg>}
            <div className="msg assistant">
              {multiAgent && (
                <div className="msg-agent muted mono">{s.agent_name}</div>
              )}
              <Transcript
                entries={s.entries}
                running={s.status === "running"}
              />
              {s.status === "failed" && (
                <div className="error">
                  failed
                  {s.exit_code != null ? ` (exit ${s.exit_code})` : ""}
                </div>
              )}
              {s.status === "stopped" && (
                <div className="muted mono stopped-note">stopped</div>
              )}
            </div>
          </div>
        );
      })}

      {failedError && stepList.length === 0 && (
        <div className="error">{failedError}</div>
      )}

      {canReply && <Reply onSend={reply} />}
      <div ref={endRef} />
      <ScrollToTop />
    </div>
  );
}

// A run's transcript grows long — thinking, tool calls, replies all stack up.
// A caret parks bottom-right once you've scrolled past a screen, jumping back up.
function ScrollToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      className="to-top"
      aria-label="Back to top"
      title="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 14l6-6 6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function Msg({
  role,
  children,
}: {
  role: "user";
  children: React.ReactNode;
}) {
  return <div className={`msg ${role}`}>{children}</div>;
}

function Transcript({
  entries,
  running,
}: {
  entries: TranscriptEntry[];
  running: boolean;
}) {
  if (entries.length === 0 && !running) return null;
  return (
    <div className="transcript">
      {entries.map((e, i) => (
        <TranscriptRow key={i} entry={e} />
      ))}
      {running && (
        <div className="tr working" aria-label="working">
          <span className="tr-icon spin">✽</span>
        </div>
      )}
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
  // text — the agent's answer (render markdown code spans / fences)
  return (
    <div className="tr text">
      <div className="tr-body">
        <RichText text={entry.text} />
      </div>
    </div>
  );
}

// Minimal markdown for code: fenced ```blocks``` and inline `spans`. Everything
// else stays plain text (React escapes it). Not a full markdown renderer.
function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const fence = /```[^\n]*\n?([\s\S]*?)```/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Inline key={key++} text={text.slice(last, m.index)} />);
    }
    parts.push(
      <pre key={key++} className="code-block">
        <code>{m[1].replace(/\n$/, "")}</code>
      </pre>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(<Inline key={key++} text={text.slice(last)} />);
  }
  return <>{parts}</>;
}

function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const code = /`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = code.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <code key={key++} className="code-inline">
        {m[1]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Reply({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="reply">
      <textarea
        className="reply-input"
        rows={3}
        placeholder="Reply… (continues the same conversation)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter to send.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
        disabled={sending}
      />
      <div className="row spread" style={{ marginTop: "var(--s-2)" }}>
        <span className="muted mono" style={{ fontSize: 12 }}>
          ⌘↵ to send
        </span>
        <button
          className="btn primary"
          onClick={send}
          disabled={sending || text.trim().length === 0}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
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
