import type { Database } from "bun:sqlite";
import { PRESETS, type AdapterPreset } from "./presets";
import {
  listAdapters,
  createAdapter,
  updateAdapter,
  deleteAdapter,
} from "../repos/adapters";
import { referencesTo } from "../refs";

export interface SyncOptions {
  presets?: AdapterPreset[];
  /** Returns true if the given executable is on PATH. */
  isInstalled?: (bin: string) => boolean;
}

const defaultIsInstalled = (bin: string): boolean => Bun.which(bin) !== null;

/**
 * Reconcile the adapters table with the built-in presets whose CLI is installed:
 * - installed preset missing → create it; command out of date → update it.
 * - preset not installed → remove its adapter row, unless an agent still
 *   references it (then keep it; runs will fail with a clear error).
 */
export function syncAdapters(db: Database, opts: SyncOptions = {}): void {
  const presets = opts.presets ?? PRESETS;
  const isInstalled = opts.isInstalled ?? defaultIsInstalled;
  const existing = listAdapters(db);
  // Key mirrors the table's UNIQUE(name) COLLATE NOCASE so the two never disagree.
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));

  for (const preset of presets) {
    const current = byName.get(preset.name.toLowerCase());
    if (isInstalled(preset.bin)) {
      if (!current) {
        createAdapter(db, { name: preset.name, command: preset.command });
      } else if (current.command !== preset.command) {
        updateAdapter(db, current.id, {
          name: preset.name,
          command: preset.command,
        });
      }
    } else if (current) {
      // Not installed: drop it unless an agent still depends on it. Check
      // references explicitly so real DB errors propagate instead of being
      // swallowed as if they were the expected "referenced" case.
      if (referencesTo(db, "adapter", current.id).length === 0) {
        deleteAdapter(db, current.id);
      }
    }
  }
}
