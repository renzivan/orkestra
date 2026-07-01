# Agents choose an adapter, a model, and a thinking effort

What ADR-0002 called a "model" (a detected CLI preset) is now an **Adapter**. An agent references an adapter (the CLI, e.g. `claude`) plus a **model** (the LLM alias — `opus`/`sonnet`/`haiku`) and an **effort** (`off`…`max`). The adapter's command template gains `{model:--model}` and `{effort:--effort}` placeholders; the adapter preset declares which models and efforts it supports, which drive the agent form. `effort = off` omits the flag.

This mirrors how tools like Paperclip model it (adapter = `claude-local`, model = opus/sonnet, plus thinking effort) and matches the real `claude` CLI, which takes `--model <alias>` and `--effort <level>`. It lets one installed CLI expose several models and reasoning levels without a separate adapter each.

## Consequences

- Schema migration v2 (gated by `PRAGMA user_version`): `models` table → `adapters`; `agents.model_id` → `adapter_id`; new `agents.model` and `agents.effort` columns. Existing rows migrate in place (verified against a real DB).
- The template engine gained scalar flag placeholders (`{name:--flag}` emits `--flag <value>`, or nothing when the value is empty) alongside the existing array form for `{projects}`.
- Supersedes the naming in ADR-0002; the detection-and-sync mechanism it introduced is unchanged, now applied to adapters.
