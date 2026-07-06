"use client";

import { useState, type ClipboardEvent } from "react";

/** Pull any files off a paste — chiefly a pasted screenshot, which the clipboard
 *  carries as an image file item. Returns [] for a plain-text paste, so callers
 *  only intercept the paste when it actually carried files. A clipboard image
 *  often has no filename; give it one so it reads sensibly as a chip and on disk. */
export function filesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (file.name) {
      out.push(file);
    } else {
      const ext = file.type.split("/")[1] || "png";
      // Wrap the bytes in a detached Blob so the name argument sticks — a File
      // passed as a blob part can leak its own name (see appendFiles note).
      const bytes = new Blob([file], { type: file.type });
      out.push(new File([bytes], `pasted.${ext}`, { type: file.type }));
    }
  }
  return out;
}

/** The minimal, serializable shape a chip needs — usable both for buffered File
 *  uploads (pre-submit) and persisted attachment rows (read-only display). */
export interface Chip {
  name: string;
  size: number;
}

/** Append incoming files to an existing buffer, renaming any whose name collides
 *  (with the buffer or with each other) to `name-2.ext`, `name-3.ext`, … Pasted
 *  screenshots all arrive as the same name, so without this the chips — and the
 *  paths handed to the model — would be indistinguishable. Mirrors the on-disk
 *  de-dup in the store, keeping the name shown, stored, and injected identical. */
export function appendFiles(existing: File[], incoming: File[]): File[] {
  const taken = new Set(existing.map((f) => f.name));
  // Snapshot each incoming file into a plain { bytes, name, type } descriptor in
  // its own pass first. Building a renamed File directly from a loop variable that
  // was also read for its .name hits a Bun mis-optimization that copies the source
  // name over the one passed to the constructor; going through a detached Blob
  // built in a separate pass sidesteps it. (Bun 1.2.18.)
  const snaps = incoming.map((f) => ({
    bytes: new Blob([f], { type: f.type }),
    name: f.name,
    type: f.type,
  }));
  const result = [...existing];
  for (const snap of snaps) {
    const name = uniqueName(snap.name, taken);
    taken.add(name);
    result.push(new File([snap.bytes], name, { type: snap.type }));
  }
  return result;
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Human-readable byte size for a chip (e.g. "12 KB", "3.4 MB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Filename chips. Read-only by default; pass onRemove to show a remove control
 *  (used while composing a task or reply, before anything is sent). */
export function AttachmentChips({
  items,
  onRemove,
}: {
  items: Chip[];
  onRemove?: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="chips">
      {items.map((c, i) => (
        <span className="chip" key={i}>
          <span className="chip-name mono">{c.name}</span>
          <span className="chip-size muted">{formatSize(c.size)}</span>
          {onRemove && (
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${c.name}`}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A drag-and-drop zone that buffers dropped files in the parent's state (files
 *  upload only when the task/reply is submitted). Controlled: the parent owns the
 *  File[] and gets the next list on every add/remove. */
export function FileDrop({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);

  function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    onChange(appendFiles(files, Array.from(list)));
  }

  return (
    <div className="stack" style={{ gap: "var(--s-2)" }}>
      <div
        className={`filedrop${over ? " over" : ""}${disabled ? " disabled" : ""}`}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (disabled) return;
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        Drop files here to attach
      </div>
      <AttachmentChips
        items={files.map((f) => ({ name: f.name, size: f.size }))}
        onRemove={
          disabled
            ? undefined
            : (i) => onChange(files.filter((_, idx) => idx !== i))
        }
      />
    </div>
  );
}
