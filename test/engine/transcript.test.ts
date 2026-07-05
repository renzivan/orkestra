import { expect, test } from "bun:test";
import { claudeStream, passthrough } from "../../lib/engine/transcript";

// Build one stream-json line.
const line = (obj: unknown) => JSON.stringify(obj) + "\n";
const ev = (event: unknown) => line({ type: "stream_event", event });

test("passthrough: stdout is the answer, transcript is one growing text block", () => {
  const changes: number[] = [];
  const t = passthrough(() => changes.push(1));
  expect(t.push("hello ")).toBe("hello ");
  expect(t.push("world")).toBe("world");
  expect(t.entries()).toEqual([{ kind: "text", text: "hello world" }]);
  expect(changes.length).toBe(2);
});

test("claudeStream: thinking and text stream as separate entries; only text is returned", () => {
  const t = claudeStream();
  let answer = "";
  answer += t.push(ev({ type: "message_start" }));
  answer += t.push(
    ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
  );
  answer += t.push(
    ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } }),
  );
  answer += t.push(
    ev({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
  );
  answer += t.push(
    ev({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "the answer" } }),
  );
  // thinking is transcript-only; only text flows into the returned answer.
  expect(answer).toBe("the answer");
  expect(t.entries()).toEqual([
    { kind: "thinking", text: "let me think" },
    { kind: "text", text: "the answer" },
  ]);
});

test("claudeStream: tool call gets its name live and full input from the assistant message", () => {
  const t = claudeStream();
  t.push(ev({ type: "message_start" }));
  // Live: tool_use block opens with just the name.
  t.push(
    ev({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu_1", name: "Read", input: {} },
    }),
  );
  let entry = t.entries()[0];
  expect(entry).toEqual({ kind: "tool_call", id: "tu_1", name: "Read", input: {} });
  // The full assistant message fills in the parsed input.
  t.push(
    line({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "a.ts" } }],
      },
    }),
  );
  entry = t.entries()[0];
  expect(entry).toEqual({
    kind: "tool_call",
    id: "tu_1",
    name: "Read",
    input: { file_path: "a.ts" },
  });
});

test("claudeStream: tool_result from a user message, string or parts", () => {
  const t = claudeStream();
  t.push(
    line({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: "file contents", is_error: false },
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            content: [{ type: "text", text: "boom" }],
            is_error: true,
          },
        ],
      },
    }),
  );
  expect(t.entries()).toEqual([
    { kind: "tool_result", toolUseId: "tu_1", content: "file contents", isError: false },
    { kind: "tool_result", toolUseId: "tu_2", content: "boom", isError: true },
  ]);
});

test("claudeStream: block indices restart each message (multi-turn agent loop)", () => {
  const t = claudeStream();
  // turn 1: text at index 0
  t.push(ev({ type: "message_start" }));
  t.push(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  t.push(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A" } }));
  // turn 2: a new message reuses index 0 — must be a NEW entry, not append to turn 1's
  t.push(ev({ type: "message_start" }));
  t.push(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  t.push(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "B" } }));
  expect(t.entries()).toEqual([
    { kind: "text", text: "A" },
    { kind: "text", text: "B" },
  ]);
});

test("claudeStream: reassembles a JSON object split across raw chunks", () => {
  const t = claudeStream();
  t.push(ev({ type: "message_start" }));
  t.push(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  const full = ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "split" } });
  const mid = Math.floor(full.length / 2);
  expect(t.push(full.slice(0, mid))).toBe(""); // no newline yet
  expect(t.push(full.slice(mid))).toBe("split");
});

test("claudeStream: ignores malformed lines", () => {
  const t = claudeStream();
  expect(t.push("not json\n")).toBe("");
  expect(t.entries()).toEqual([]);
});

test("claudeStream captures the session id from the stream", () => {
  const t = claudeStream();
  expect(t.sessionId()).toBe("");
  t.push(line({ type: "system", subtype: "init", session_id: "sess-abc" }));
  expect(t.sessionId()).toBe("sess-abc");
});

test("claudeStream: usage() is null until a result line, then maps token counts", () => {
  const t = claudeStream();
  expect(t.usage()).toBeNull();
  t.push(
    line({
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 123,
        output_tokens: 456,
        cache_creation_input_tokens: 78,
        cache_read_input_tokens: 90,
      },
    }),
  );
  // The CLI's cache_*_input_tokens map onto our cache_* names.
  expect(t.usage()).toEqual({
    input_tokens: 123,
    output_tokens: 456,
    cache_creation_tokens: 78,
    cache_read_tokens: 90,
  });
});

test("claudeStream: a result line missing a usage field defaults it to 0", () => {
  const t = claudeStream();
  t.push(
    line({ type: "result", subtype: "success", usage: { input_tokens: 5 } }),
  );
  expect(t.usage()).toEqual({
    input_tokens: 5,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  });
});

test("claudeStream: a result line with no usage object leaves usage() null", () => {
  const t = claudeStream();
  t.push(line({ type: "result", subtype: "success" }));
  expect(t.usage()).toBeNull();
});

test("passthrough: usage() is always null (a plain-text CLI reports none)", () => {
  expect(passthrough().usage()).toBeNull();
});
