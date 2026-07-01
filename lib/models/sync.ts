import type { Database } from "bun:sqlite";
import { PRESETS, type ModelPreset } from "./presets";
import { listModels, createModel, updateModel, deleteModel } from "../repos/models";
import { referencesTo } from "../refs";

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
  // Key mirrors the table's UNIQUE(name) COLLATE NOCASE so the two never disagree.
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
      // Not installed: drop it unless an agent still depends on it. Check
      // references explicitly so real DB errors propagate instead of being
      // swallowed as if they were the expected "referenced" case.
      if (referencesTo(db, "model", current.id).length === 0) {
        deleteModel(db, current.id);
      }
    }
  }

  // Rows for presets that no longer exist at all are left untouched; only
  // known presets are managed here.
  void presetNames;
}
