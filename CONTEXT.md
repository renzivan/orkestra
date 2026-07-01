# Orkestra

A local agent orchestrator. Users define reusable agents, skills, and projects on their own machine, then compose agents into flows that run one after another, passing output down the line.

## Language

**Agent**:
A configured actor that performs one step of work. Composed of an identity, a base instruction (its core, always-on behavior — like a CLAUDE.md/AGENTS.md), zero or more skills layered on top, zero or more projects it works on, and one model it runs on. When an agent runs, all its project paths are made available in context; there is no single working directory.
_Avoid_: Bot, worker, assistant

**Base instruction**:
An agent's own core, always-on instruction that defines its persistent behavior, analogous to a CLAUDE.md/AGENTS.md. Distinct from skills: every agent has exactly one base instruction; skills are optional additions on top.
_Avoid_: System prompt, persona, role

**Skill**:
A reusable, portable capability — a name plus markdown instruction text — optionally layered on top of an agent's base instruction to shape how it works. Attaching multiple skills concatenates their text after the base instruction. Shared across agents; not tied to any one project.
_Avoid_: Ability, tool, plugin

**Project**:
A concrete local working target an agent operates on — typically a directory/codebase on disk.
_Avoid_: Workspace, repo, folder

**Flow**:
An ordered, linear pipeline of agents. Each agent runs in turn; its output feeds the next agent's input.
_Avoid_: Pipeline, chain, workflow, graph

**Model**:
A built-in preset describing how to spawn a local CLI (e.g. `claude`), defined in code and made available only when its executable is found on PATH. Its command template's placeholders — the system text (base instruction + skills), the input, and the agent's project paths — are filled to build the command Orkestra runs. An agent is assigned one model. Not user-authored: there is no models UI; presets are detected, not entered.
_Avoid_: LLM, provider, backend, engine, adapter

**Task**:
A unit of work the user creates (an issue/task), targeting either a flow or a single agent. Running a task feeds its text as the initial input to that target. Holds the run's status and results.
_Avoid_: Issue, job, ticket, run
