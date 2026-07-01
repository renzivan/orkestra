# Models are built-in presets detected from installed CLIs, not user-authored

Orkestra no longer has a Models page or model CRUD. Models are defined as built-in presets in code (`lib/models/presets.ts`), each naming a CLI executable. On load, `syncModels` reconciles the `models` table with the presets whose binary is found on PATH (via `Bun.which`): installed → created/updated, not installed → removed unless an agent still references it. Only `claude` ships today; more presets are added in code.

This walks back part of ADR-0001's "user-registered command templates": the shell-out-via-template mechanism stays, but authoring moves from the user to code presets. We did it because hand-entering command templates was real friction, and detecting installed CLIs means the model list reflects the machine — a preset for a tool you don't have installed simply never appears.

## Consequences

- Adding a provider is now a code change (new preset), not a UI action — the flexibility ADR-0001 optimized for is traded for zero-friction, correct-by-default UX. Acceptable: the set of agent CLIs is small and slow-moving.
- The `models` table and `agents.model_id` FK are unchanged; the runner is unchanged. Only the source of model rows changed (sync instead of a form).
- An agent whose model's CLI is later uninstalled keeps its (now-referenced) model row and fails at run time with a clear error, rather than silently vanishing.
