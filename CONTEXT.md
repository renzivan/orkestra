# Orkestra

A local agent orchestrator. Users define reusable agents, skills, and projects on their own machine, then compose agents into flows that run one after another, passing output down the line.

## Language

**Agent**:
A configured actor that performs one step of work. Composed of an identity, its instruction files (its core, always-on behavior — like a set of CLAUDE.md/AGENTS.md files), zero or more skills layered on top, zero or more projects it works on, and an adapter + model + thinking effort it runs on. When an agent runs, all its project paths are made available in context; there is no single working directory.
_Avoid_: Bot, worker, assistant

**Instruction file**:
One named markdown file (a name plus a body) making up part of an agent's core, always-on behavior, analogous to an AGENTS.md/CLAUDE.md. An agent has an ordered set of them; exactly one is the **entry file**, which leads. They compose into the agent's system text entry-first, each under a `# filename` heading. Distinct from skills, which are shared across agents; instruction files belong to one agent.
_Avoid_: System prompt, persona, role, base instruction

**Entry file**:
The one instruction file per agent marked as the entry point. It composes first, ahead of the agent's other instruction files. Every agent has exactly one and it can't be deleted (reassign the entry to another file first).
_Avoid_: Main, root, index

**Skill**:
A reusable, portable capability — a name plus markdown instruction text — optionally layered on top of an agent's instruction files to shape how it works. Attaching multiple skills concatenates their text after the instruction files. Shared across agents; not tied to any one project.
_Avoid_: Ability, tool, plugin

**Project**:
A concrete local working target an agent operates on — typically a directory/codebase on disk.
_Avoid_: Workspace, repo, folder

**Flow**:
An ordered, linear pipeline of agents. Each agent runs in turn; its output feeds the next agent's input.
_Avoid_: Pipeline, chain, workflow, graph

**Adapter**:
A built-in preset describing how to spawn a local CLI (e.g. `claude`), defined in code and made available only when its executable is found on PATH. Its command template's placeholders — the system text (instruction files + skills), the input, the model, the effort, and the agent's project paths — are filled to build the command Orkestra runs. An agent uses one adapter. Not user-authored: there is no adapter UI; presets are detected, not entered.
_Avoid_: Provider, backend, engine, driver

**Model**:
The specific LLM an agent runs on (e.g. `opus`, `sonnet`, `haiku`), passed to the adapter's CLI. Each adapter declares the models it supports; an agent picks one.
_Avoid_: LLM, adapter, provider

**Effort**:
The thinking-effort level an agent runs with (`off`, `low`, `medium`, `high`, `xhigh`, `max`), passed to the adapter's CLI. `off` omits the flag, using the CLI's own default.
_Avoid_: Reasoning, thinking budget

**Task**:
A unit of work the user creates (an issue/task), targeting either a flow or a single agent. Running a task feeds its text as the initial input to that target. Holds the run's status and results.
_Avoid_: Issue, job, ticket, run
