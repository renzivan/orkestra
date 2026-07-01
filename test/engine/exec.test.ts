import { expect, test } from "bun:test";
import { runStep } from "../../lib/engine/exec";

const FIXTURE = "test/fixtures/echo-model.sh";

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
