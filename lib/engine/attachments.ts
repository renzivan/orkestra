import { dirname } from "path";

/**
 * Fold attachment file paths into a step's stdin input.
 *
 * Orkestra can only give a CLI a file by *path*: the input is piped to stdin and
 * the CLI reads local files itself (with read permission granted via the dirs it
 * was passed — see the runner's extraDirs). So an attachment becomes a delimited
 * block of absolute paths appended to the user's text, plus the set of parent
 * directories the CLI must be allowed to read. Pure — no db, no fs — so it is the
 * whole read mechanism in one testable place.
 *
 * Returns the text unchanged and no dirs when there are no paths, so callers can
 * apply it unconditionally.
 */
export function withAttachments(
  text: string,
  paths: string[],
): { input: string; dirs: string[] } {
  if (paths.length === 0) return { input: text, dirs: [] };
  const block = `Attached files (read as needed):\n${paths
    .map((p) => `- ${p}`)
    .join("\n")}`;
  // Keep the user's text leading; drop the separator when there is no text so a
  // bare-attachment input isn't a stray "---".
  const input = text.trim() ? `${text}\n\n---\n${block}` : block;
  // De-duplicate parent dirs — many files usually share the one per-task dir, and
  // the CLI only needs each directory exposed once.
  const dirs = [...new Set(paths.map((p) => dirname(p)))];
  return { input, dirs };
}
