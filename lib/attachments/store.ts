import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { orkestraHome } from "../db";

/** The on-disk directory holding one task's attachments (body + replies). One
 *  dir per task keeps read-exposure to a single path and lets a task delete wipe
 *  everything with one rm. */
export function taskAttachmentDir(taskId: number): string {
  return join(orkestraHome(), "attachments", String(taskId));
}

export interface StoredFile {
  filename: string;
  disk_path: string;
  size: number;
}

/**
 * Write one uploaded file into a task's attachment dir and return where it
 * landed. The name is reduced to its basename (a dropped file must never write
 * outside the dir) and de-duplicated against what's already there — `log.txt`
 * then `log-2.txt`, `log-3.txt` — so two files with the same name both survive.
 */
export function writeAttachment(
  taskId: number,
  filename: string,
  bytes: Uint8Array,
): StoredFile {
  const dir = taskAttachmentDir(taskId);
  mkdirSync(dir, { recursive: true });
  const safe = basename(filename) || "file";
  const name = dedupe(dir, safe);
  const disk_path = join(dir, name);
  writeFileSync(disk_path, bytes);
  return { filename: name, disk_path, size: bytes.byteLength };
}

/** Remove a task's whole attachment dir (used when the task is deleted; the DB
 *  rows go by FK cascade). Safe when the dir was never created. */
export function removeTaskAttachments(taskId: number): void {
  rmSync(taskAttachmentDir(taskId), { recursive: true, force: true });
}

/** Pick a name that doesn't collide in `dir`, inserting `-2`, `-3`, … before the
 *  extension until one is free. */
function dedupe(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}
