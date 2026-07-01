// Built-in adapter presets. An adapter is a local CLI Orkestra can drive. It is
// only made available if its `bin` is on PATH (see sync.ts). Each declares the
// models it can run and the thinking-effort levels it supports (for the agent
// form). Add more adapters here later — they appear only when installed.
export interface AdapterPreset {
  /** Adapter name shown in the UI and stored in the adapters table. */
  name: string;
  /** Executable that must be on PATH for this adapter to be available. */
  bin: string;
  /** Command template Orkestra fills and spawns. */
  command: string;
  /** Models this adapter can run (passed via {model}). */
  models: string[];
  /** Effort levels (passed via {effort}); "off" means no --effort flag. */
  efforts: string[];
}

export const PRESETS: AdapterPreset[] = [
  {
    name: "claude",
    bin: "claude",
    command:
      "claude -p {model:--model} {effort:--effort} --append-system-prompt {system} {projects:--add-dir}",
    models: ["opus", "sonnet", "haiku"],
    efforts: ["off", "low", "medium", "high", "xhigh", "max"],
  },
];

export function presetByName(name: string): AdapterPreset | undefined {
  return PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}
