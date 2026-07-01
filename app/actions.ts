"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import * as Skills from "@/lib/repos/skills";
import * as Projects from "@/lib/repos/projects";
import * as Agents from "@/lib/repos/agents";
import * as Flows from "@/lib/repos/flows";
import * as Tasks from "@/lib/repos/tasks";
import * as Settings from "@/lib/repos/settings";
import { runTask } from "@/lib/engine/runner";
import type { Settings as SettingsT, TargetType } from "@/lib/types";

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

// Models are built-in presets synced from installed CLIs (see lib/models/sync.ts);
// they have no create/edit/delete UI.

// ---- Agents ----
export async function saveAgent(input: {
  id?: number;
  name: string;
  base_instruction: string;
  adapter_id: number;
  model: string;
  effort: string;
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

export async function runTaskAction(taskId: number): Promise<{ ok: true }> {
  Tasks.setTaskStatus(db(), taskId, "running");
  revalidate("/tasks");
  // Fire and forget — many tasks may run concurrently.
  void runTask(db(), taskId).catch(() => {
    /* failure is persisted on the run/task by runTask itself */
  });
  return { ok: true };
}
