import type { RefKind } from "@/lib/refs";
import { referencesToAction } from "./actions";

/**
 * Build the confirmation message for deleting an entity. Deletion is never
 * blocked, but when other things still reference it we list them so the user
 * sees the impact (agents lose a skill/project, flows shrink, tasks may become
 * non-runnable) before confirming.
 */
export async function deleteConfirmMessage(
  kind: RefKind,
  id: number,
  name: string,
): Promise<string> {
  const refs = await referencesToAction(kind, id);
  if (refs.length === 0) return `Delete "${name}"? This can't be undone.`;
  const lines = refs.map((r) => `  • ${r.kind} "${r.name}"`).join("\n");
  // Deleting an agent reassigns its tasks to the Default agent (so they stay
  // runnable) and drops its flow steps; other kinds just detach.
  const footer =
    kind === "agent"
      ? "Tasks that target it will be reassigned to the Default agent; flows will drop this step. This can't be undone."
      : "These will be updated or blocked. This can't be undone.";
  return `Delete "${name}"?\n\nUsed by:\n${lines}\n\n${footer}`;
}
