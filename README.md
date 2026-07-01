# Orkestra

A local agent orchestrator. Define reusable **skills**, **projects**, **models**, and **agents**, compose agents into linear **flows**, then run a **task** through a flow (or a single agent). Orkestra runs each agent by spawning a local CLI, piping the input to its stdin and chaining its stdout into the next agent. Output streams live to the browser.

See `CONTEXT.md` for the domain glossary, `docs/plans/orkestra.html` for the implementation plan, and `docs/adr/` for architecture decisions.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2 — Orkestra runs on the Bun runtime (it uses `bun:sqlite`).

## Run

```bash
bun install
bun run seed        # optional: seeds a runnable demo (no LLM needed)
bun --bun run dev   # http://localhost:3000  — MUST use --bun (bun:sqlite)
```

Open `http://localhost:3000`, go to **Tasks**, and click **Run**.

Data lives in a single SQLite file at `~/.orkestra/orkestra.db` (override with `ORKESTRA_DB`).

## Develop

```bash
bun test          # unit + integration + e2e (engine tested against a fake CLI)
bun run typecheck  # tsc --noEmit — the type gate
```

### Note on `next build`

Orkestra is a **local app run via `bun --bun run dev`**. A production `next build`
is currently blocked by an upstream Bun 1.2.18 crash in Next's build worker pool
(`panic: Segmentation fault` — a bug in Bun, not this code). Types are gated
separately with `bun run typecheck` (Node `tsc`), which passes. When Bun fixes
the worker-pool crash, `bun --bun run build` will work as-is.

## Models are trusted (security)

A **model** is a command template that Orkestra executes locally via
`Bun.spawn(argv, …)` — **no shell**, so task/skill/project values cannot inject
commands. However, the model *command itself* is user-authored and run verbatim:
anyone who can create a model has arbitrary local code execution. This is by
design (see `docs/adr/0001-shell-out-to-cli-via-command-templates.md`). Only add
models you trust. Orkestra has no auth and is meant to run on your own machine.
