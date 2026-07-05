# Token tracking per run — design (Roadmap §9)

Surface how many tokens each run consumes.
Tokens only — no dollar cost, no pricing table.

Domain language follows `CONTEXT.md`.
No new domain term is introduced: this is a measurement attached to existing Run / Run step / Agent entities.

## Goal

Show token usage at three grains:

- **Per step** — each transcript step shows the tokens that step consumed.
- **Per run** — the run/task view shows the run's summed total.
- **Per agent** — the agent view shows a lifetime total summed across all of that agent's steps.

Explicitly out of scope: dollar cost, per-model pricing, and over-time / Space-level trend charts.

## Why tokens-only

The only adapter today is `claude`, whose `--output-format stream-json` stream ends with a `type:"result"` line that reports usage directly.
Cost was considered and dropped: the user wants raw token counts, not dollars.
That removes the pricing table the roadmap floated (§9) and any per-model price maintenance.

## Data model

`run_steps` is the capture grain.
Every other number is a sum over these rows.

Add four nullable columns to `run_steps`:

```
input_tokens          INTEGER   -- nullable
output_tokens         INTEGER
cache_creation_tokens INTEGER
cache_read_tokens     INTEGER
```

This is a plain `ALTER TABLE run_steps ADD COLUMN` migration, following the `transcript` (migrations.ts:122) and `session_id` (migrations.ts:126) additions.
No table rebuild is needed.

**Nullable is meaningful.**
`NULL` means "the adapter did not report usage" and renders as `—`.
`0` would be a real reported zero.
An adapter that reports no usage (e.g. a future plain-text CLI) leaves all four `NULL`.

**All four are stored and shown separately.**
Cache reads usually dominate a Claude run, so a single total would hide the real shape.
Aggregates sum each column independently.

## Capture path

The `claude` stream ends with a line like:

```json
{"type":"result","subtype":"success","usage":{
  "input_tokens":123,"output_tokens":456,
  "cache_creation_input_tokens":78,"cache_read_input_tokens":90}}
```

The transcript parser currently discards this line (`transcript.ts` — "system / result / … — not transcript").
It will read the `usage` object from it.

### `StreamTransform` gains a `usage()` accessor

A new method mirrors the existing `sessionId()`:

```ts
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface StreamTransform {
  // … existing members …
  /** Cumulative usage seen in the stream, or null if the CLI reported none. */
  usage(): Usage | null;
}
```

- `claudeStream` handles the `type:"result"` line and stores usage, mapping `cache_creation_input_tokens` → `cache_creation_tokens` and `cache_read_input_tokens` → `cache_read_tokens`.
- `passthrough` returns `null`.

### Runner wiring

This mirrors how `sessionId` already flows (`runner.ts`).

- `attemptWithRetries` reads `transform.usage()` after each attempt and keeps the latest, exactly as it keeps `sessionId`.
  A retried step therefore reports the **successful** attempt's usage, not the sum of all attempts.
- `executeStep` calls a new repo function `Runs.setStepUsage(db, stepId, usage)` — parallel to the existing `setStepSession` — after the step settles.
  A `null` usage writes nothing (columns stay `NULL`).

Each run step is one CLI invocation, so a step's stored usage is exactly that invocation's usage.
Resume and reply steps are their own `run_steps` rows and capture their own usage; aggregation just sums the rows.

## Reads

Server Components read repos directly (per `CONVENTIONS.md`); no server action is involved because nothing here is a user mutation.

- **Per-run total** — `SUM(input_tokens)`, `SUM(output_tokens)`, etc. over the run's steps.
  Exposed on the run read (extend `RunWithSteps` or add a sibling read).
- **Per-agent lifetime** — the same four sums over `run_steps WHERE agent_id = ?`.

`SUM` over all-`NULL` rows yields `NULL`, which the UI renders as `—` — consistent with the per-step rule.

## UI

- **Per step** — a token line in the transcript step footer (input / output / cache-create / cache-read).
- **Per run** — the summed total on the run/task view.
- **Per agent** — the lifetime total on the agent view.

`NULL` → `—` at every grain.

## Testing

- Parser: a `claudeStream` fed a `result` line exposes the mapped `usage()`; a stream with no `result` line returns `null`; `passthrough` returns `null`.
- Repo: `setStepUsage` writes the four columns; the per-run and per-agent sum reads aggregate correctly, and an all-`NULL` set returns `NULL`.
- Runner: a retried step stores the successful attempt's usage, not the sum.
- Migration: the four columns exist and default to `NULL` on existing rows.

## Open questions

- None blocking.
  Future adapters that report usage in a different shape map into `Usage` at their own parser; the storage and read layers are adapter-agnostic.
