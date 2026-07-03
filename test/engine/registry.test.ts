import { expect, test } from "bun:test";
import {
  register,
  pause,
  setProc,
  clearProc,
  stop,
  isAborted,
  abortIntent,
  unregister,
} from "../../lib/engine/registry";

test("stop marks a run aborted and kills its live process", async () => {
  const runId = 900001;
  register(runId);
  expect(isAborted(runId)).toBe(false);

  const proc = Bun.spawn(["sleep", "30"]);
  setProc(runId, proc);

  stop(runId);
  expect(isAborted(runId)).toBe(true);

  // The killed process exits promptly rather than sleeping the full 30s.
  const code = await proc.exited;
  expect(code).not.toBe(0);

  unregister(runId);
});

test("stop before a process spawns still marks the run aborted", () => {
  const runId = 900002;
  register(runId);
  stop(runId);
  expect(isAborted(runId)).toBe(true);
  unregister(runId);
});

test("register resets a previously aborted run (resume reuses the id)", () => {
  const runId = 900003;
  register(runId);
  stop(runId);
  expect(isAborted(runId)).toBe(true);

  register(runId); // resume re-registers the same run id
  expect(isAborted(runId)).toBe(false);
  unregister(runId);
});

test("clearProc detaches the handle so a later stop kills nothing", async () => {
  const runId = 900004;
  register(runId);
  const proc = Bun.spawn(["sleep", "0.05"]);
  setProc(runId, proc);
  await proc.exited;
  clearProc(runId);
  // No live process to kill — stop just flips the flag without throwing.
  expect(() => stop(runId)).not.toThrow();
  expect(isAborted(runId)).toBe(true);
  unregister(runId);
});

test("isAborted is false for an unregistered run", () => {
  expect(isAborted(987654)).toBe(false);
});

test("pause and stop record distinct intents; register resets", () => {
  register(1);
  expect(isAborted(1)).toBe(false);
  expect(abortIntent(1)).toBeNull();

  pause(1);
  expect(isAborted(1)).toBe(true);
  expect(abortIntent(1)).toBe("pause");

  register(2);
  stop(2);
  expect(isAborted(2)).toBe(true);
  expect(abortIntent(2)).toBe("stop");

  // Reusing a run id (a resume re-registers) clears the prior intent.
  register(1);
  expect(isAborted(1)).toBe(false);
  expect(abortIntent(1)).toBeNull();

  unregister(1);
  unregister(2);
});
