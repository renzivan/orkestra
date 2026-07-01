// Built-in model presets. Each is a local CLI Orkestra can drive. A preset is
// only made available if its `bin` is found on PATH (see sync.ts). Add more
// here later (e.g. codex, ollama) — they'll appear only when installed.
export interface ModelPreset {
  /** Model name shown in the UI and stored in the models table. */
  name: string;
  /** Executable that must be on PATH for this preset to be available. */
  bin: string;
  /** Command template Orkestra fills and spawns. */
  command: string;
}

export const PRESETS: ModelPreset[] = [
  {
    name: "claude",
    bin: "claude",
    command: "claude -p --append-system-prompt {system} {projects:--add-dir}",
  },
];
