import type { Database } from "bun:sqlite";
import { PRESETS, type ModelPreset } from "./presets";
import { listModels, createModel, updateModel, deleteModel } from "../repos/models";

export interface SyncOptions {
  presets?: ModelPreset[];
  /** Returns true if the given executable is on PATH. */
  isInstalled?: (bin: string) => boolean;
}

const defaultIsInstalled = (bin: string): boolean => Bun.which(bin) !== null;

/**
 * Reconcile the models table with the built-in presets whose CLI is installed:
 * - installed preset missing → create it; command out of date → update it.
 * - preset not installed → remove its model row, unless an agent still
 *   references it (then keep it; runs will fail with a clear error).
 */
export function syncModels(db: Database, opts: SyncOptions = {}): void {
  const presets = opts.presets ?? PRESETS;
  const isInstalled = opts.isInstalled ?? defaultIsInstalled;
  const existing = listModels(db);
  const byName = new Map(existing.map((m) => [m.name.toLowerCase(), m]));
  const presetNames = new Set(presets.map((p) => p.name.toLowerCase()));

  for (const preset of presets) {
    const current = byName.get(preset.name.toLowerCase());
    if (isInstalled(preset.bin)) {
      if (!current) {
        createModel(db, { name: preset.name, command: preset.command });
      } else if (current.command !== preset.command) {
        updateModel(db, current.id, {
          name: preset.name,
          command: preset.command,
        });
      }
    } else if (current) {
      // Not installed: drop it unless something depends on it.
      try {
        deleteModel(db, current.id);
      } catch {
        // Referenced by an agent — keep it.
      }
    }
  }

  // Rows for presets that no longer exist at all are left untouched; only
  // known presets are managed here.
  void presetNames;
}
