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
  adapter_id: number;
  model: string;
  effort: string; // "" means off (no --effort flag)
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
export type TaskStatus = "pending" | "running" | "succeeded" | "failed";
export type RunStatus = "running" | "succeeded" | "failed";

export interface Task {
  id: number;
  title: string;
  body: string;
  target_type: TargetType;
  target_id: number;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface RunStep {
  id: number;
  run_id: number;
  position: number;
  agent_id: number;
  agent_name: string;
  input: string;
  output: string;
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
}

export interface Ref {
  kind: string;
  name: string;
}
