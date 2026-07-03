"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import * as Skills from "@/lib/repos/skills";
import * as Projects from "@/lib/repos/projects";
import * as Agents from "@/lib/repos/agents";
import * as Flows from "@/lib/repos/flows";
import * as Tasks from "@/lib/repos/tasks";
import { latestRunForTask } from "@/lib/repos/runs";
import * as Settings from "@/lib/repos/settings";
import { runTask, replyToRun, resumeRun } from "@/lib/engine/runner";
import { stop, pause } from "@/lib/engine/registry";
import { referencesTo, type RefKind } from "@/lib/refs";
import { taskRunnable } from "@/lib/runnable";
import type { Ref, Settings as SettingsT, TargetType } from "@/lib/types";

export type DeleteResult = { ok: true } | { ok: false; error: string };

function revalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Called outside a request (e.g. tests) — nothing to revalidate.
  }
}

function tryDelete(fn: () => void, path: string): DeleteResult {
  try {
    fn();
    revalidate(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What still points at this entity — shown in the delete-confirmation dialog so
 *  the user sees the impact before deleting (delete itself is never blocked). */
export async function referencesToAction(
  kind: RefKind,
  id: number,
): Promise<Ref[]> {
  return referencesTo(db(), kind, id);
}

/** Translate raw SQLite unique-constraint errors into a friendly message. */
function withFriendly<T>(kind: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint/i.test(msg)) {
      throw new Error(`A ${kind} with that name already exists.`);
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

// ---- Skills ----
export async function saveSkill(input: { id?: number; name: string; body: string }) {
  const row = withFriendly("skill", () =>
    input.id
      ? Skills.updateSkill(db(), input.id!, input)
      : Skills.createSkill(db(), input),
  );
  revalidate("/skills");
  return row;
}
export async function deleteSkillAction(id: number): Promise<DeleteResult> {
  return tryDelete(() => Skills.deleteSkill(db(), id), "/skills");
}

// ---- Projects ----
export async function saveProject(input: { id?: number; name: string; path: string }) {
  const row = withFriendly("project", () =>
    input.id
      ? Projects.updateProject(db(), input.id!, input)
      : Projects.createProject(db(), input),
  );
  revalidate("/projects");
  return row;
}
export async function deleteProjectAction(id: number): Promise<DeleteResult> {
  return tryDelete(() => Projects.deleteProject(db(), id), "/projects");
}

/**
 * Open a native folder picker on the machine running the server and return the
 * chosen absolute path (or null if the user cancels). This is a local dev tool,
 * so the browser can't supply real filesystem paths — the OS dialog can.
 */
export async function pickDirectory(): Promise<{ path: string | null }> {
  if (process.platform !== "darwin") {
    throw new Error("The folder picker is only available on macOS.");
  }
  const proc = Bun.spawn(
    [
      "osascript",
      "-e",
      'POSIX path of (choose folder with prompt "Select a project directory")',
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    // Cancelling the dialog exits 1 with "User canceled." — not an error.
    if (/User canceled/i.test(stderr)) return { path: null };
    throw new Error(stderr.trim() || "Folder picker failed.");
  }
  return { path: stdout.trim().replace(/\/+$/, "") };
}

// Adapters are built-in presets synced from installed CLIs (see
// lib/adapters/sync.ts); they have no create/edit/delete UI.

// ---- Agents ----
export async function saveAgent(input: {
  id?: number;
  name: string;
  base_instruction: string;
  adapter_id: number;
  model: string;
  effort: string;
  skip_permissions?: boolean;
  skill_ids: number[];
  project_ids: number[];
}) {
  const row = withFriendly("agent", () =>
    input.id
      ? Agents.updateAgent(db(), input.id!, input)
      : Agents.createAgent(db(), input),
  );
  revalidate("/agents");
  return row;
}
export async function deleteAgentAction(id: number): Promise<DeleteResult> {
  return tryDelete(() => Agents.deleteAgent(db(), id), "/agents");
}

// ---- Flows ----
export async function saveFlow(input: {
  id?: number;
  name: string;
  agent_ids: number[];
}) {
  const row = withFriendly("flow", () =>
    input.id
      ? Flows.updateFlow(db(), input.id!, input)
      : Flows.createFlow(db(), input),
  );
  revalidate("/flows");
  return row;
}
export async function deleteFlowAction(id: number): Promise<DeleteResult> {
  return tryDelete(() => Flows.deleteFlow(db(), id), "/flows");
}

// ---- Settings ----
export async function saveSettings(input: SettingsT) {
  const row = Settings.updateSettings(db(), input);
  revalidate("/settings");
  return row;
}

// ---- Tasks ----
export async function createTaskAction(input: {
  title: string;
  body: string;
  target_type: TargetType;
  target_id: number;
}) {
  const task = Tasks.createTask(db(), input);
  revalidate("/tasks");
  return task;
}

export async function deleteTaskAction(id: number): Promise<DeleteResult> {
  const task = Tasks.getTask(db(), id);
  // A live run holds a subprocess — kill it before the row cascades away, or the
  // process is orphaned. stop() is a safe no-op if the run isn't tracked; the
  // runner's later terminal-write targets already-deleted rows (a no-op UPDATE).
  if (task?.status === "running") {
    const latest = latestRunForTask(db(), id);
    if (latest) stop(latest.id);
  }
  return tryDelete(() => Tasks.deleteTask(db(), id), "/tasks");
}

export async function runTaskAction(
  taskId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const task = Tasks.getTask(db(), taskId);
  if (!task) return { ok: false, error: "task not found" };
  // Defense against a stale client: the Run button is disabled when a task is
  // non-runnable, but re-check here so a deleted target never starts a run.
  const runnable = taskRunnable(db(), task);
  if (!runnable.ok) return { ok: false, error: runnable.reason! };

  Tasks.setTaskStatus(db(), taskId, "running");
  revalidate("/tasks");
  // Fire and forget — many tasks may run concurrently.
  void runTask(db(), taskId).catch(() => {
    /* failure is persisted on the run/task by runTask itself */
  });
  return { ok: true };
}

/** Reply to a finished run, resuming its conversation with another step. */
export async function replyToRunAction(
  runId: number,
  text: string,
): Promise<{ ok: true }> {
  // replyToRun reopens the run + adds the step synchronously before its first
  // await, so a refresh right after this sees the run 'running'.
  void replyToRun(db(), runId, text).catch(() => {
    /* failure is persisted on the run/task by replyToRun itself */
  });
  revalidate("/tasks");
  return { ok: true };
}

/** Pause a running run: halt it now but keep it resumable. The runner transitions
 *  the run/task to 'paused', preserves the interrupted step + its session, and
 *  publishes the terminal event; Resume continues it with --resume. */
export async function pauseRunAction(runId: number): Promise<{ ok: true }> {
  pause(runId);
  revalidate("/tasks");
  return { ok: true };
}

/** Stop a running run terminally: flag it aborted and kill its live process. The
 *  runner transitions the run/task to 'stopped'; the run stays as history and
 *  only Re-run (a fresh run) is offered. */
export async function stopRunAction(runId: number): Promise<{ ok: true }> {
  stop(runId);
  revalidate("/tasks");
  return { ok: true };
}

/** Mark a task's detail as seen, clearing it from the sidebar unread badge.
 *  Revalidates the layout (the badge lives there) so the count drops. */
export async function markTaskSeenAction(id: number): Promise<{ ok: true }> {
  Tasks.markTaskSeen(db(), id);
  revalidate("/tasks");
  return { ok: true };
}

/** Resume a paused run: continue from its interrupted step (--resume), keeping
 *  prior work. */
export async function resumeRunAction(runId: number): Promise<{ ok: true }> {
  // resumeRun reopens the run + resets the step synchronously before its first
  // await, so a refresh right after this sees the run 'running'.
  void resumeRun(db(), runId).catch(() => {
    /* failure is persisted on the run/task by resumeRun itself */
  });
  revalidate("/tasks");
  return { ok: true };
}

/** Resume a task from the board by resolving its latest run, then resuming that.
 *  Lets a paused card offer Resume without the board tracking run ids. */
export async function resumeTaskAction(
  taskId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const latest = latestRunForTask(db(), taskId);
  if (!latest) return { ok: false, error: "no run to resume" };
  void resumeRun(db(), latest.id).catch(() => {
    /* failure is persisted on the run/task by resumeRun itself */
  });
  revalidate("/tasks");
  return { ok: true };
}
