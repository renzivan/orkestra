export interface Skill {
  id: number;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Adapter {
  id: number;
  name: string;
  command: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: number;
  name: string;
  base_instruction: string;
  /** null when the adapter was deleted — agent is non-runnable until reassigned. */
  adapter_id: number | null;
  model: string;
  effort: string; // "" means off (no --effort flag)
  skip_permissions: boolean; // headless runs: skip approval prompts so it can act
  /** The built-in Default agent: undeletable, name-locked, scoped to all
   *  projects, preselected on new tasks, and the reassign target when another
   *  agent is deleted. Exactly one row has this set. */
  is_default: boolean;
  skills: Skill[];
  projects: Project[];
  created_at: string;
  updated_at: string;
}

export interface Flow {
  id: number;
  name: string;
  agents: Agent[];
  created_at: string;
  updated_at: string;
}

export type TargetType = "flow" | "agent";
export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "paused";
export type RunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "paused";

export interface Task {
  id: number;
  title: string;
  body: string;
  target_type: TargetType;
  target_id: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  // Set when the task last entered a terminal status (succeeded/failed/stopped).
  settled_at: string | null;
  // Set when the user last opened the task's detail page. A task counts as
  // unread while seen_at is null or older than settled_at (see countUnreadTasks).
  seen_at: string | null;
}

export interface RunStep {
  id: number;
  run_id: number;
  position: number;
  agent_id: number;
  agent_name: string;
  input: string;
  output: string;
  /** JSON array of TranscriptEntry (lib/engine/transcript) — live step activity. */
  transcript: string;
  /** CLI session id, if captured — lets a finished run be resumed with a reply. */
  session_id: string | null;
  exit_code: number | null;
  error: string | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
}

export interface Run {
  id: number;
  task_id: number;
  status: RunStatus;
  final_output: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Settings {
  retries: number;
  step_timeout_seconds: number;
  /** Short key (≤4 chars) prepended to task titles as "<prefix>-<id>: <title>". */
  task_prefix: string;
}

export interface Ref {
  kind: string;
  name: string;
}
