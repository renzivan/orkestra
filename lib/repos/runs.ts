import type { Database } from "bun:sqlite";
import type { Run, RunStatus, RunStep } from "../types";

export function startRun(db: Database, taskId: number): Run {
  const now = new Date().toISOString();
  return db
    .query(
      `INSERT INTO runs (task_id, status, started_at)
       VALUES ($task, 'running', $now) RETURNING *`,
    )
    .get({ $task: taskId, $now: now }) as Run;
}

export interface RunStepInput {
  position: number;
  agent_id: number;
  agent_name: string;
  input: string;
}

export function addRunStep(
  db: Database,
  runId: number,
  input: RunStepInput,
): number {
  const now = new Date().toISOString();
  const row = db
    .query(
      `INSERT INTO run_steps (run_id, position, agent_id, agent_name, input, status, started_at)
       VALUES ($run, $pos, $aid, $aname, $in, 'running', $now) RETURNING id`,
    )
    .get({
      $run: runId,
      $pos: input.position,
      $aid: input.agent_id,
      $aname: input.agent_name,
      $in: input.input,
      $now: now,
    }) as { id: number };
  return row.id;
}

export interface RunStepResult {
  output: string;
  exit_code: number | null;
  error: string | null;
  status: RunStatus;
}

export function finishRunStep(
  db: Database,
  stepId: number,
  result: RunStepResult,
): void {
  const now = new Date().toISOString();
  db.query(
    `UPDATE run_steps SET output = $out, exit_code = $code, error = $err,
       status = $status, finished_at = $now WHERE id = $id`,
  ).run({
    $id: stepId,
    $out: result.output,
    $code: result.exit_code,
    $err: result.error,
    $status: result.status,
    $now: now,
  });
}

/** Append a streamed chunk to a step's output (used for live updates). */
export function appendStepOutput(
  db: Database,
  stepId: number,
  chunk: string,
): void {
  db.query(
    "UPDATE run_steps SET output = output || $chunk WHERE id = $id",
  ).run({ $id: stepId, $chunk: chunk });
}

/** Reset a step's output before a retry attempt. */
export function clearStepOutput(db: Database, stepId: number): void {
  db.query("UPDATE run_steps SET output = '' WHERE id = ?").run(stepId);
}

/**
 * Mark any run/step/task left in 'running' as failed. Called on startup so a
 * process that crashed mid-run doesn't leave rows stuck forever.
 */
export function reconcileStaleRuns(db: Database): void {
  const now = new Date().toISOString();
  db.query(
    `UPDATE run_steps SET status='failed',
       error=COALESCE(error,'interrupted'), finished_at=$now
     WHERE status='running'`,
  ).run({ $now: now });
  db.query(
    `UPDATE runs SET status='failed',
       error=COALESCE(error,'interrupted'), finished_at=$now
     WHERE status='running'`,
  ).run({ $now: now });
  db.query(
    "UPDATE tasks SET status='failed', updated_at=$now WHERE status='running'",
  ).run({ $now: now });
}

export interface RunResult {
  status: RunStatus;
  final_output: string | null;
  error: string | null;
}

export function finishRun(db: Database, id: number, result: RunResult): void {
  const now = new Date().toISOString();
  db.query(
    `UPDATE runs SET status = $status, final_output = $final, error = $err,
       finished_at = $now WHERE id = $id`,
  ).run({
    $id: id,
    $status: result.status,
    $final: result.final_output,
    $err: result.error,
    $now: now,
  });
}

export interface RunWithSteps extends Run {
  steps: RunStep[];
}

export function getRunWithSteps(db: Database, id: number): RunWithSteps {
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run | null;
  if (!run) throw new Error(`run ${id} not found`);
  const steps = db
    .query("SELECT * FROM run_steps WHERE run_id = ? ORDER BY position")
    .all(id) as RunStep[];
  return { ...run, steps };
}

export function latestRunForTask(db: Database, taskId: number): Run | null {
  return (
    (db
      .query(
        "SELECT * FROM runs WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId) as Run) ?? null
  );
}
