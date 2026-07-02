# Orkestra — Code Style & Architecture Guide

This guide codifies the conventions already present in the Orkestra codebase.
It is descriptive of how the code is actually written, not aspirational.
Follow it for every change. When in doubt, match the nearest existing code over any rule stated here.

Read `CONTEXT.md` for the domain glossary (Agent, Skill, Project, Flow, Adapter, Model, Effort, Task).
Domain terms in code and prose must use those words and avoid the listed synonyms.

## 1. Stack & runtime

- Runtime is **Bun**, not Node.
The app uses `bun:sqlite`, so it must run with `bun --bun run dev` and tests with `bun test`.
- Framework is **Next 16 App Router** with **React 19**.
- There is **no production build** step in the normal loop — `next build` is blocked by an upstream Bun crash (see `README.md`).
The type gate is `bun run typecheck` (Node `tsc --noEmit`); it must pass.
- Data is a single SQLite file (`~/.orkestra/orkestra.db`, override with `ORKESTRA_DB`).

## 2. Architecture layers

Dependencies point one direction: `app → lib`, and within `lib`, `engine → repos → db`.
Never import upward (a repo must not import the engine; `lib` must not import from `app`).

- `lib/db` — connection, migrations, schema. `openDb()` runs migrations and `reconcileStaleRuns`; `db()` returns the shared process-wide connection.
- `lib/repos` — one file per entity. Pure data access. The only place that writes SQL.
- `lib/engine` — run orchestration (runner, exec, transcript, bus, registry, template). Composes repos; owns no SQL.
- `lib/adapters` — built-in CLI presets, detected not authored.
- `app/` — UI (Server + Client Components) and **server actions** (`app/actions.ts`).

**The UI never calls `db()` or a repo directly.**
All mutations go through a server action.
Reads in Server Components may call repos, but writes always route through `app/actions.ts`.

## 3. Repo pattern

Repos are plain functions, never classes or stateful modules.

- Every repo function takes `db: Database` as its **first parameter**.
- Named exports only; no default exports.
- Input shapes are `interface`s (e.g. `TaskInput`) colocated in the repo file.
- SQL uses **`$named` parameters**, `RETURNING *` on insert, and a single `as Type` cast at the boundary — see `lib/repos/tasks.ts`.
- Timestamps are ISO strings: `new Date().toISOString()`.
- Getters return `T | null` (coalesce with `?? null`); listers return `T[]`.
- Cascades belong in the schema (FK `ON DELETE CASCADE`), not in code — document them in a comment on the delete fn.

```ts
export function getTask(db: Database, id: number): Task | null {
  return (db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task) ?? null;
}
```

## 4. Types

- Shared domain interfaces live in `lib/types.ts`.
- Import types with `import type { ... }`.
- Results that can fail are **discriminated unions**, not exceptions across a boundary:
`type DeleteResult = { ok: true } | { ok: false; error: string }`, and the engine's `StepOutcome`.
- **snake_case** for database columns and the domain interfaces that mirror them (`target_type`, `created_at`).
- **camelCase** for function names, locals, and non-DB parameters (`runId`, `taskLabel`).
- Prefer narrow inline object types on action inputs over exporting one-off interfaces.

## 5. Server actions

`app/actions.ts` starts with `"use server"` and is the app's write surface.

- Import repos as namespaces: `import * as Tasks from "@/lib/repos/tasks"`.
Use the `@/` path alias, not deep relative paths, from `app`.
- Wrap `revalidatePath` in the local `revalidate()` helper — it swallows the "called outside a request" error so actions stay callable from tests.
- Translate SQLite constraint errors with `withFriendly(kind, fn)` before they reach the user.
- Long-running work is **fire-and-forget**: `void runTask(...).catch(() => {})`, with a comment noting that failure is persisted on the run/task itself.
- Re-check invariants server-side even when the UI already guards them (see `runTaskAction`'s runnable re-check) — assume a stale client.

## 6. Comments

Dense, purposeful comments are this codebase's signature. Match that density.

- Block/JSDoc comments explain **why** and state **invariants and edge cases** — not what the line obviously does.
See `runner.ts` (`executeStep`, the abort-vs-exit-code note) and `lib/db/index.ts` (the `globalThis` singleton rationale).
- Every exported function that isn't trivially named gets a doc comment.
- Comment the non-obvious: the safe no-op, the fire-and-forget, the "defense against a stale client", the reason a value is `let` not `const`.
- Do not add narration comments that restate the code.

## 7. Errors

- Normalize unknowns at every catch: `e instanceof Error ? e.message : String(e)`.
- In the engine, `throw new Error(...)` with lowercase, contextual messages (`` `task ${taskId} not found` ``).
- Actions convert throws into a result union rather than letting them escape to the client.
- The abort flag, not a process exit code, is the source of truth for "was this stopped" — never infer a user stop from a non-zero exit.

## 8. Formatting

- 2-space indentation, double quotes, trailing commas in multiline literals.
- No semicolon-free style — semicolons are used.
- In Markdown, put each full sentence on its own physical line.

## 9. Testing

- `bun test`. Test files mirror the `lib/` tree under `test/` (e.g. `test/repos/tasks.test.ts`, `test/engine/runner.test.ts`).
- Import from `bun:test` (`expect`, `test`).
- Use `openDb(":memory:")` for a fresh isolated DB per test.
- The engine is tested against **fake CLI fixtures** (`test/fixtures/*.sh`) — no real LLM.
- Cover the negative path (deletion cascades, guard rejections, stop/resume), not just the happy path.
- Fix a failing or flaky test you encounter even if it predates your change.

## 10. Git & graph

- Commit directly to **main**; do not branch per feature.
- **Ask before committing and pushing.**
- Conventional-ish subjects (`feat:`, `refactor:`, `docs:`). Do not add an agent co-author trailer.
- After modifying code, run `graphify update .` to keep `graphify-out/` current.
- For codebase questions, prefer `graphify query "<question>"` over raw grep (see `CLAUDE.md`).
