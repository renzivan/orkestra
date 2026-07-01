import { expect, test } from "bun:test";
import { runStep } from "../../lib/engine/exec";
import { claudeStream } from "../../lib/engine/transcript";

const FIXTURE = "test/fixtures/echo-model.sh";
const STREAM_FIXTURE = "test/fixtures/stream-json-model.sh";

test("pipes input to stdin and captures stdout", async () => {
  const r = await runStep({
    argv: ["bash", FIXTURE, "--flag"],
    input: "hi",
    timeoutMs: 5000,
  });
  expect(r.exitCode).toBe(0);
  expect(r.timedOut).toBe(false);
  expect(r.stdout.trim()).toBe("OUT[--flag]:hi");
});

test("streams stdout chunks via onChunk", async () => {
  let seen = "";
  const r = await runStep({
    argv: ["bash", FIXTURE],
    input: "stream me",
    timeoutMs: 5000,
    onChunk: (c) => {
      seen += c;
    },
  });
  expect(seen).toBe(r.stdout);
  expect(seen).toContain("stream me");
});

test("claudeStream parses stream-json into clean text, streamed incrementally", async () => {
  const chunks: { text: string; at: number }[] = [];
  const t0 = Date.now();
  const r = await runStep({
    argv: ["bash", STREAM_FIXTURE],
    input: "go",
    timeoutMs: 5000,
    transform: claudeStream(),
    onChunk: (c) => chunks.push({ text: c, at: Date.now() - t0 }),
  });
  // Only assistant text survives — JSON noise is stripped.
  expect(r.stdout).toBe("one two three ");
  // Arrived as separate chunks over time, not one buffered blob at the end.
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[chunks.length - 1].at - chunks[0].at).toBeGreaterThan(0);
});

test("nonzero exit is reported", async () => {
  const r = await runStep({
    argv: ["bash", "-c", "exit 3"],
    input: "",
    timeoutMs: 5000,
  });
  expect(r.exitCode).toBe(3);
});

test("times out and kills a hung process", async () => {
  const r = await runStep({
    argv: ["sleep", "5"],
    input: "",
    timeoutMs: 50,
  });
  expect(r.timedOut).toBe(true);
  expect(r.exitCode).not.toBe(0);
});
