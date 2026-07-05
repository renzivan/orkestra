import type { Database } from "bun:sqlite";
import type { Run, RunStatus, RunStep, Usage } from "../types";

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

/** Persist the step's live transcript (JSON) so a reload mid-run catches up. */
export function setStepTranscript(
  db: Database,
  stepId: number,
  transcript: string,
): void {
  db.query("UPDATE run_steps SET transcript = $t WHERE id = $id").run({
    $id: stepId,
    $t: transcript,
  });
}

/** Reset a step's transcript before a retry attempt. */
export function clearStepTranscript(db: Database, stepId: number): void {
  db.query("UPDATE run_steps SET transcript = '[]' WHERE id = ?").run(stepId);
}

/** Store the CLI session id captured for a step (used to resume the run). */
export function setStepSession(
  db: Database,
  stepId: number,
  sessionId: string,
): void {
  db.query("UPDATE run_steps SET session_id = $s WHERE id = $id").run({
    $id: stepId,
    $s: sessionId,
  });
}

/** Store the token usage a CLI reported for a step. Overwrites, so a retried
 *  step ends holding its final (successful) attempt's usage, not a sum. */
export function setStepUsage(db: Database, stepId: number, usage: Usage): void {
  db.query(
    `UPDATE run_steps SET input_tokens = $in, output_tokens = $out,
       cache_creation_tokens = $cc, cache_read_tokens = $cr WHERE id = $id`,
  ).run({
    $id: stepId,
    $in: usage.input_tokens,
    $out: usage.output_tokens,
    $cc: usage.cache_creation_tokens,
    $cr: usage.cache_read_tokens,
  });
}

// Sum the four token columns over a set of steps. SQLite's SUM returns NULL when
// every row is NULL, so a run/agent where no step reported usage yields null —
// keeping "reported none" distinct from a real zero.
function sumUsage(db: Database, where: string, arg: number): Usage | null {
  const row = db
    .query(
      `SELECT SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_creation_tokens) AS cache_creation_tokens,
              SUM(cache_read_tokens) AS cache_read_tokens
         FROM run_steps WHERE ${where}`,
    )
    .get(arg) as Record<keyof Usage, number | null>;
  if (row.input_tokens === null && row.output_tokens === null &&
      row.cache_creation_tokens === null && row.cache_read_tokens === null) {
    return null;
  }
  // A partially-reported set (some steps NULL) sums the reported ones and treats
  // the gaps as 0 — the honest total of what we actually know.
  return {
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cache_creation_tokens: row.cache_creation_tokens ?? 0,
    cache_read_tokens: row.cache_read_tokens ?? 0,
  };
}

/** Total token usage across a run's steps, or null if none reported. */
export function runUsage(db: Database, runId: number): Usage | null {
  return sumUsage(db, "run_id = ?", runId);
}

/** Lifetime token usage for an agent across every run it ran in, or null. */
export function agentUsage(db: Database, agentId: number): Usage | null {
  return sumUsage(db, "agent_id = ?", agentId);
}

/**
 * Token usage of each Space task's LATEST run, keyed by task id, for the board.
 * A task appears only if its latest run reported usage — tasks that never ran,
 * or whose latest run reported none, are absent (the card shows no Tokens line).
 * "Latest" is the highest run id for the task.
 */
export function latestRunUsageByTask(
  db: Database,
  spaceId: number,
): Record<number, Usage> {
  const rows = db
    .query(
      `SELECT t.id AS task_id,
              SUM(rs.input_tokens) AS input_tokens,
              SUM(rs.output_tokens) AS output_tokens,
              SUM(rs.cache_creation_tokens) AS cache_creation_tokens,
              SUM(rs.cache_read_tokens) AS cache_read_tokens
         FROM tasks t
         JOIN runs r
           ON r.id = (SELECT id FROM runs WHERE task_id = t.id
                        ORDER BY id DESC LIMIT 1)
         JOIN run_steps rs ON rs.run_id = r.id
        WHERE t.space_id = ?
        GROUP BY t.id`,
    )
    .all(spaceId) as (Record<keyof Usage, number | null> & { task_id: number })[];
  const map: Record<number, Usage> = {};
  for (const row of rows) {
    // Same NULL rule as sumUsage: all four NULL means the latest run reported
    // nothing — omit it rather than show a zeroed total.
    if (row.input_tokens === null && row.output_tokens === null &&
        row.cache_creation_tokens === null && row.cache_read_tokens === null) {
      continue;
    }
    map[row.task_id] = {
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      cache_creation_tokens: row.cache_creation_tokens ?? 0,
      cache_read_tokens: row.cache_read_tokens ?? 0,
    };
  }
  return map;
}

/** Reopen a finished run so a reply can append another step. */
export function reopenRun(db: Database, id: number): void {
  db.query(
    "UPDATE runs SET status='running', finished_at=NULL, error=NULL WHERE id=?",
  ).run(id);
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
