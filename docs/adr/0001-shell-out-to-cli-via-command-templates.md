# Reach models by shelling out to local CLIs via user-defined command templates

Orkestra runs each agent against an LLM by spawning a local command-line tool (e.g. `claude`, `ollama`) rather than calling provider HTTP APIs directly. A model is a user-registered command template with placeholders (input, system text, project paths) that Orkestra fills to build the exact command; the engine ships no provider-specific code.

We chose this to deliver "any LLM, per agent" with a single uniform code path: adding a new tool is writing a template, not writing an adapter. It reuses each CLI's own runtime, tools, and file access for free. The trade-off is less uniform control over the request/tool loop and dependence on whatever CLIs the user has installed, versus building and maintaining N direct-API adapters.

## Considered Options

- **Direct provider HTTP APIs behind adapter interfaces** — full control of prompt/tool loop, but an adapter per provider and we rebuild tool-use/file-access that CLIs already provide.
- **Built-in code adapters per known CLI** — nice UX for supported tools, but a new CLI needs code + rebuild; fails the "any LLM" goal.
- **Command templates (chosen)** — generic, one code path, any CLI with no code change; built-in support is just shipped preset templates.

## Consequences

- **Trust boundary.** Placeholder values (task input, skills, project paths) are safe — Orkestra builds an argv array and calls `Bun.spawn(argv, …)` with no shell, so they cannot inject commands. But the model *command itself* is user-authored and executed verbatim: creating a model is equivalent to arbitrary local code execution. Acceptable because Orkestra is a single-user local tool with no auth; documented in the README.
- Orkestra depends on whatever CLIs the user has installed; a model referencing a missing binary fails at run time (surfaced as a failed step).
