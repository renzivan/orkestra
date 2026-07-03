# Orkestra — Roadmap / Future Features

Ideas not yet built.
Design notes and open questions, not commitments.
Domain language follows `CONTEXT.md`; new terms proposed here should be added there once a feature lands.

---

## 1. Workspaces (top-level isolation)

Create a Workspace and get a fresh, blank Orkestra: its own Projects, Tasks, Flows, Agents, Skills, and Settings, fully isolated from every other Workspace.
Goal: one Workspace for personal, one for work, with no bleed between them.

### Naming conflict — resolve before building

`CONTEXT.md` already lists **Workspace** as a word to _avoid_ (it is a banned synonym for **Project**).
The feature described here is not a Project — it is the isolation container that _holds_ Projects.
Pick a distinct term so the glossary stays clean. Candidates:

- **Space** — short, clear, no clash.
- **Vault** — implies isolation.
- **Realm** / **Scope** — also free.

Recommendation: **Space**.
Whatever wins, add it to `CONTEXT.md` Language and mark the old avoid-note accordingly.

### Design notes

- Storage: the app is already single-SQLite (`~/.orkestra/orkestra.db`, `ORKESTRA_DB` override).
  Natural fit: one DB file per Space, e.g. `~/.orkestra/spaces/<slug>.db`.
  A Space switch = point the shared connection at a different file.
- The connection is process-wide (`db()` in `lib/db`).
  Switching Spaces means re-opening the DB and re-running migrations for the target file — decide whether that is a process restart or a live re-open.
- Adapters are detected from PATH, not stored, so they are naturally Space-independent — good.
- UI: a Space switcher (top-level), plus create / rename / delete.

### Open questions

- Is a Space ever active for more than one browser tab at once? (Global connection says one active Space per process.)
- Migrating existing data into a default Space on first upgrade.
- Export / import a whole Space (ties into §5 backup/export).

---

## 2. Workspace folder scope (sandbox root)

Optional Setting: pick one folder.
The whole Space — and every Agent in it — may only touch that folder and everything under it.
Nothing outside is reachable.

### Design notes

- An Agent has no single working directory; instead **all its Project paths are made available in context** (see `CONTEXT.md`).
  So scope enforcement has two layers:
  1. **Validation** — reject/normalise any Project path that is not under the Space root.
  2. **Runtime** — constrain the spawned CLI. Orkestra spawns via `Bun.spawn(argv, …)` with no shell; set `cwd` to the root and, where the adapter supports it, pass an allowed-paths / permission flag (e.g. Claude Code's directory permissions).
- Enforcement must live below the UI — in the engine at spawn time — so it holds even if a Project path is crafted directly.
- Reality check: a Model command is user-authored and runs verbatim with full local rights (see ADR 0001 + README "Models are trusted").
  A folder scope is a **guardrail against accident**, not a security sandbox against a hostile Model command. Document it as such.

### Open questions

- Symlinks that escape the root — resolve realpath and re-check.
- Per-Agent override vs strict Space-wide only.

---

## 3. Remote access over WhatsApp

Use Orkestra from your phone over WhatsApp while the app runs on your local machine — so you can drive it while out.

### Design notes

- Bridge options:
  - **WhatsApp Business / Cloud API** (official, needs a number + Meta app; webhooks).
  - **whatsapp-web.js / Baileys** (unofficial, pairs your existing number, no Meta approval; ToS risk).
- The local machine must be reachable: a tunnel (Cloudflare Tunnel / ngrok) for the inbound webhook, or a long-poll/outbound bridge so no inbound port is opened.
- Auth: allowlist your own phone number(s). Reject everything else — there is no app auth today.
- This is the transport for §4 (the chat). Keep the WhatsApp adapter thin; put the command logic in §4.

### Open questions

- Streaming: task output streams live to the browser today. Over WhatsApp, stream as chunked messages or send one summary on completion? (Likely: progress pings + final result.)
- Media: send transcripts/artifacts as files vs inline text.

---

## 4. Chat control surface

A chat interface that can do anything the app can: create / edit / move / delete Tasks; create / edit / delete Agents, Skills, Projects, Flows; run Tasks; read results.
The WhatsApp bridge (§3) is one frontend to it; an in-app chat panel is another.

### Design notes

- Model it as a natural-language layer over the existing **server actions** (`app/actions.ts`) — the single mutation path.
  The chat interpreter turns a message into one or more server-action calls; it never writes SQL or hits repos directly (respects the layering in `CONVENTIONS.md`).
- Two build paths:
  1. **Orkestra eats itself** — the chat is just a built-in Agent whose Skills expose Orkestra's own actions as callable tools. Elegant, dogfoods the product.
  2. **Dedicated command router** — explicit intent → action mapping. More predictable, less magic.
  Recommendation: start with (2) for a safe verb set, grow toward (1).
- Destructive verbs (delete Task/Agent/Flow) should confirm before executing.

### Open questions

- Does the chat run as its own Space-scoped Agent, or sit above Spaces and switch between them?
- Undo / audit log for chat-driven mutations.

---

## Suggested additions

Beyond the four above. Grouped by leverage.

---

## High leverage

### 5. Notifications on task completion

Desktop and/or push notifications when a Task finishes, plus delivery over WhatsApp (§3).
Long runs finish while you are away; you should hear about it without watching the browser.

Design notes:

- The engine already streams run status to the browser (bus in `lib/engine`).
  A notification is a subscriber on run-complete / run-failed events — add a sink, do not rebuild the eventing.
- Channels: OS notification (web Notifications API for the in-browser case), WhatsApp message via §3, optional email/webhook later.
- Space-scoped preference (§1): which channels, and notify-on-fail-only vs always.

Open questions:

- Browser closed = no web notification. Push needs a service worker (ties into PWA, §14) or the WhatsApp path.
- Debounce noisy Flows (per-step vs only final).

### 6. Scheduled / triggered Tasks

Cron-style schedules and/or webhook triggers that run a Task automatically.
Turns Orkestra from manual-run into an automation surface.

Design notes:

- A scheduler process ticks and enqueues runs through the same path as a manual run (server action → engine) — no second run path.
- The app is a local `bun --bun run dev` process; schedules only fire while it is up. Document that, or add a launch-on-login helper.
- Webhook triggers overlap with §15 (HTTP API) — build the trigger endpoint once, reuse.

Open questions:

- Persist next-run time in SQLite so a restart recovers schedules.
- Overlap policy: skip, queue, or run concurrently if the previous run is still going.

### 7. Secrets / env management per Space

Store API keys and env vars scoped to a Space (§1), injected into the Agent's process at spawn, never committed into a Project.

Design notes:

- Injection point is `Bun.spawn(argv, { env })` in the engine — add resolved secrets to the child env there.
- Storage: SQLite in the Space DB. At minimum keep them out of Project dirs; consider at-rest encryption (OS keychain) as a follow-up.
- Reference by name in Agent/Model config; resolve at spawn so secrets never sit in a command template.

Open questions:

- Precedence: Space-level vs Agent-level override.
- Masking secrets in transcripts and logs (they can leak via child stdout).

### 8. Retry / resume runs

Re-run a failed Task, or resume a Flow from the failed Agent instead of restarting from the top.

Design notes:

- Resume needs each step's input/output persisted (the transcript already records the chain in `lib/engine`).
  Resume = replay stored output of the last good Agent as input to the failed one.
- Retry-from-top is trivial (re-run the Task); resume-from-step is the real work.

Open questions:

- Non-determinism: upstream Agents may now produce different output — resume trusts the stored boundary, make that explicit.
- Editing a Flow after a run invalidates resume points; version or pin the Flow used by a run (ties into §16).

---

## Medium

### 9. Cost / token tracking per run

Surface tokens and $ per Task, per Agent, and over time.

Design notes:

- Source is each adapter CLI's own usage output — parse from stdout/stderr where the CLI reports it; not all will.
- Store per-step usage on the transcript; aggregate in reads (Server Components may read repos directly).
- Pricing table per Model to turn tokens → $.

Open questions:

- Adapters that do not report usage — show "unknown" rather than guess.

### 10. Flow export / import & templates

Share a Flow (with its Agents and Skills) as a file; seed new Spaces (§1) from templates.

Design notes:

- Export a Flow + its dependency graph (Agents → Skills) to a portable JSON. Adapters are detected, not stored — export the Model/adapter name and re-bind on import.
- Import validates that referenced adapters exist on PATH before enabling.

Open questions:

- Secrets (§7) must be stripped on export.
- Project paths are machine-specific — export as placeholders to remap on import.

### 11. Human-in-the-loop step

A Flow step that pauses for approval or edit before feeding the next Agent.
Pairs with §3/§4 — approve from your phone.

Design notes:

- Engine gains a pause state: run halts, persists pending input, waits for an approve/edit/reject action.
- Resume via server action (or chat §4) mirrors the resume machinery in §8.

Open questions:

- Timeout behaviour: hold indefinitely vs auto-cancel.
- Where the approval UI lives (in-app card + WhatsApp prompt).

### 12. Search across Tasks & transcripts

Full-text search over past runs and their output.

Design notes:

- SQLite FTS5 over Task text + transcript output; index on write in the repo layer.
- Scope search to the active Space (§1).

Open questions:

- Index size/retention for long transcripts — cap or prune.

### 13. Parallel step in a Flow

Fan out to N Agents, then join their outputs.

Design notes:

- **Model change, not a quiet feature.** `CONTEXT.md` defines a Flow as strictly linear and lists "graph" among avoided terms.
  This revisits that decision — do it deliberately, update the glossary and ADRs.
- Join strategy: concatenate outputs, or a designated merge Agent.

Open questions:

- Failure semantics: one branch fails — fail the join, or proceed with survivors?
- Concurrency limits when spawning many CLIs at once.

---

## Lower / later

### 14. PWA / mobile-responsive UI

A lighter-weight remote option than WhatsApp for when you have a browser.

Design notes:

- Service worker also unlocks web push for §5.
- Still needs the machine reachable (tunnel, as in §3).

### 15. HTTP API / webhooks to trigger Tasks

Let external tools kick off runs. Also the substrate for §3 (WhatsApp bridge) and §6 (scheduling).

Design notes:

- Thin API over the same server actions; auth via a Space-scoped token (there is no app auth today).
- Build the trigger endpoint once; §3 and §6 consume it.

### 16. Versioning of Agents / Skills

History and rollback of instruction text (base instruction, Skill markdown).

Design notes:

- Append-only revisions in the repo layer; current pointer + history.
- Enables pinning the exact Agent/Flow version a run used (needed by §8 resume).

### 17. MCP tool support for Agents

Expose MCP servers to an Agent's adapter where the CLI supports it.

Design notes:

- Adapters are detected presets (ADR 0002); MCP config would be passed through the adapter's command template where the CLI accepts it (e.g. Claude Code).
- Space-scoped (§1) MCP server list, resolved at spawn.

---

## Storage / SQLite considerations

Verdict: **SQLite stays the right choice.**
This is a local, single-user, single-process app — an embedded file DB is the correct fit, not a server DB.
Nothing on this roadmap changes that.
But several future features add concurrent writers, and the current streaming-write path is not tuned for that.
Address these before the concurrency features (§3, §6, §13, §15) land.

Current state: `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` are set (`lib/db/index.ts`).
No `busy_timeout`. Streaming persists per chunk.

### 1. Add `busy_timeout` — prerequisite for concurrency

SQLite allows one writer at a time (WAL gives concurrent readers, still a single writer).
Today only one run executes at a time, so this never bites.
But WhatsApp (§3), the scheduler (§6), parallel Flow steps (§13), and the HTTP API (§15) all introduce concurrent runs writing at once.
Without a busy timeout, the second writer fails immediately with `database is locked` instead of waiting.

Fix: `PRAGMA busy_timeout = 5000` in `openDb()`. Cheap, and a hard prerequisite for every concurrency feature.

### 2. Throttle streaming writes — currently O(n²) per run

`appendChunk` runs `UPDATE run_steps SET output = output || $chunk` on every streamed chunk, and the full transcript JSON snapshot is rewritten on every change (`lib/repos/runs.ts`).
SQLite rewrites the entire cell on each append, so total bytes written grow quadratically with transcript length.
Short runs are fine; long runs are wasteful, and the cost multiplies under concurrent runs.

Fix: buffer and flush on an interval or byte threshold (e.g. every ~100 ms or N KB) instead of every chunk.
The live view already reloads from a full snapshot, so a small flush lag is invisible.

### 3. `PRAGMA synchronous = NORMAL`

Safe under WAL and reduces fsyncs, which directly helps the streaming write path.
Consider setting it alongside the pragmas above.

### 4. Keep large artifacts out of the DB

Store big outputs/artifacts on the filesystem and keep only a path in SQLite.
Relevant to long transcripts and Flow export (§10). Keeps the DB file lean and backups fast.

### Feature-specific notes

- **Spaces (§1)** — file-per-Space is SQLite's home turf. Back up / export a Space with `VACUUM INTO` for a consistent snapshot while the app is running.
- **Scheduler (§6)** — keep it in-process. The connection is process-wide (`db()`); a separate scheduler process would open a second connection contending for the same file. In-process avoids that.
- **Secrets (§7)** — `bun:sqlite` has no built-in at-rest encryption. Use the OS keychain rather than encrypting the DB.
- **Search (§12)** — FTS5 is bundled in `bun:sqlite`; no external search engine needed.
- **Parallel steps (§13)** — the biggest write-concurrency stressor. Items 1 and 2 above are prerequisites for it.
