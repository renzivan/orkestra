import type { InstructionInput } from "../lib/repos/agents";

/** A single ENTRY instruction file — the common shape for tests that only need
 *  one instruction. Mirrors the pre-v11 `base_instruction` field: the given
 *  text becomes the body of an `AGENTS.md` entry file. */
export function entryFile(body: string): InstructionInput[] {
  return [{ name: "AGENTS.md", body, is_entry: true }];
}
