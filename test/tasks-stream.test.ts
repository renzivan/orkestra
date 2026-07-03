import { expect, test } from "bun:test";
import { GET } from "../app/api/tasks/stream/route";
import { publishTasksChanged } from "../lib/engine/bus";

test("tasks stream is SSE and nudges on a task change", async () => {
  const res = GET(new Request("http://x/api/tasks/stream"));
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const reader = res.body!.getReader();
  const dec = new TextDecoder();

  // The stream opens with a ": connected" comment to flush headers.
  const first = await reader.read();
  expect(dec.decode(first.value)).toContain(": connected");

  // A change published while a client is listening arrives as a "changed" nudge.
  publishTasksChanged();
  const { value } = await reader.read();
  expect(dec.decode(value)).toContain('"type":"changed"');

  await reader.cancel();
});

test("cancelling the stream unsubscribes; later changes don't throw", async () => {
  const res = GET(new Request("http://x/api/tasks/stream"));
  const reader = res.body!.getReader();

  // Simulate the client navigating away.
  await reader.cancel();

  // A late publish (e.g. a run settling right after disconnect) must not crash
  // the process — regression for "Controller is already closed".
  expect(() => publishTasksChanged()).not.toThrow();
});

test("aborting the request unsubscribes without throwing", async () => {
  const ctrl = new AbortController();
  const res = GET(
    new Request("http://x/api/tasks/stream", { signal: ctrl.signal }),
  );
  const reader = res.body!.getReader();

  ctrl.abort();
  expect(() => publishTasksChanged()).not.toThrow();

  await reader.cancel().catch(() => {});
});
