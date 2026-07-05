// Live transcript of a running step: the ordered activity an agent produces —
// its reasoning, the tools it calls, their results, and its answer text. This
// is what the UI renders live so you can see what the agent is *currently
// doing*, not just the final answer.
//
// The step's persisted output / the text chained into the next agent is the
// assistant's answer text ONLY (the `text` entries). Thinking and tool activity
// are transcript-only — never chained.

import type { Usage } from "../types";
export type { Usage };

export type TranscriptEntry =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; content: string; isError: boolean };

// A StreamTransform turns a CLI's raw stdout into the clean answer text (what
// `push`/`end` return, accumulated into the step output) while also maintaining
// the live transcript (read via `entries`). `onChange` fires whenever the
// transcript changes so the caller can persist + broadcast it. Stateful — build
// a fresh one per process attempt.
export interface StreamTransform {
  /** Feed a raw stdout chunk; returns clean answer-text delta (maybe ""). */
  push(raw: string): string;
  /** Flush a trailing line with no terminating newline; returns its text. */
  end(): string;
  /** Current transcript snapshot. */
  entries(): TranscriptEntry[];
  /** CLI session id seen in the stream (""), for resuming the conversation. */
  sessionId(): string;
  /** Token usage the CLI reported for this invocation, or null if it reported
   *  none (e.g. a plain-text CLI, or a stream that never emitted a usage). */
  usage(): Usage | null;
}

/** Plain-text CLIs: stdout IS the answer; the transcript is one growing block. */
export function passthrough(onChange?: () => void): StreamTransform {
  const list: TranscriptEntry[] = [];
  const feed = (raw: string): string => {
    if (!raw) return raw;
    let entry = list[0];
    if (!entry || entry.kind !== "text") {
      entry = { kind: "text", text: "" };
      list.unshift(entry);
    }
    entry.text += raw;
    onChange?.();
    return raw;
  };
  return {
    push: feed,
    end: () => "",
    entries: () => list,
    sessionId: () => "",
    usage: () => null,
  };
}

/**
 * Parser for Claude's `--output-format stream-json --include-partial-messages`
 * JSONL. Thinking and answer text stream token-by-token (from content-block
 * deltas); tool calls and results arrive per message. Skips signature/system/
 * result/hook noise. Returns answer-text deltas from push/end.
 */
export function claudeStream(onChange?: () => void): StreamTransform {
  const list: TranscriptEntry[] = [];
  let buffer = "";
  let sessionId = "";
  let usage: Usage | null = null;
  // Content-block index -> entry, for the CURRENT assistant message. Block
  // indices restart at 0 each message, so this is cleared on message_start.
  let openByIndex = new Map<number, TranscriptEntry>();
  let dirty = false;

  const consume = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return "";
    }
    return handle(obj);
  };

  const handle = (obj: Record<string, unknown>): string => {
    if (typeof obj.session_id === "string" && obj.session_id) {
      sessionId = obj.session_id;
    }
    const type = obj.type;
    if (type === "stream_event") return handleStreamEvent(rec(obj.event));
    if (type === "assistant") {
      reconcileToolInputs(rec(obj.message));
      return "";
    }
    if (type === "user") {
      handleToolResults(obj);
      return "";
    }
    if (type === "result") {
      // The final result line reports this invocation's token usage. It is not
      // transcript activity, but it is the authoritative usage total — capture it.
      usage = parseUsage(obj.usage);
      return "";
    }
    return ""; // system / rate_limit_event / hooks — not transcript
  };

  const handleStreamEvent = (ev: Record<string, unknown>): string => {
    const et = ev.type;
    if (et === "message_start") {
      openByIndex = new Map();
      return "";
    }
    if (et === "content_block_start") {
      const index = num(ev.index);
      const block = rec(ev.content_block);
      const bt = block.type;
      let entry: TranscriptEntry | null = null;
      if (bt === "thinking") entry = { kind: "thinking", text: "" };
      else if (bt === "text") entry = { kind: "text", text: "" };
      else if (bt === "tool_use")
        entry = { kind: "tool_call", id: str(block.id), name: str(block.name), input: {} };
      if (entry) {
        list.push(entry);
        openByIndex.set(index, entry);
        dirty = true;
      }
      return "";
    }
    if (et === "content_block_delta") {
      const entry = openByIndex.get(num(ev.index));
      if (!entry) return "";
      const delta = rec(ev.delta);
      if (delta.type === "thinking_delta" && entry.kind === "thinking") {
        entry.text += str(delta.thinking);
        dirty = true;
      } else if (delta.type === "text_delta" && entry.kind === "text") {
        const t = str(delta.text);
        entry.text += t;
        dirty = true;
        return t; // answer text — flows into the step output / next agent
      }
      return "";
    }
    return ""; // content_block_stop / signature_delta / message_delta / stop
  };

  // The `assistant` message carries each tool_use block's fully-parsed input,
  // which the streaming deltas only send as raw JSON fragments. Fill it in.
  const reconcileToolInputs = (message: Record<string, unknown>): void => {
    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = rec(raw);
      if (block.type !== "tool_use") continue;
      const id = str(block.id);
      const entry = list.find((e) => e.kind === "tool_call" && e.id === id);
      if (entry && entry.kind === "tool_call") {
        entry.input = block.input ?? {};
        dirty = true;
      }
    }
  };

  const handleToolResults = (obj: Record<string, unknown>): void => {
    const message = rec(obj.message);
    const content = Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = rec(raw);
      if (block.type !== "tool_result") continue;
      list.push({
        kind: "tool_result",
        toolUseId: str(block.tool_use_id),
        content: toolResultText(block.content),
        isError: block.is_error === true,
      });
      dirty = true;
    }
  };

  const drain = (fn: (line: string) => string): string => {
    let out = "";
    dirty = false;
    out = fn(out);
    if (dirty) onChange?.();
    return out;
  };

  return {
    push(raw) {
      buffer += raw;
      return drain(() => {
        let out = "";
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          out += consume(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
        return out;
      });
    },
    end() {
      return drain(() => {
        const out = consume(buffer);
        buffer = "";
        return out;
      });
    },
    entries: () => list,
    sessionId: () => sessionId,
    usage: () => usage,
  };
}

// Map Claude's result `usage` object onto our Usage shape. Its cache counts are
// named cache_*_input_tokens; a missing field defaults to 0. Returns null when
// there is no usage object at all, so "reported none" stays distinct from zeros.
function parseUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const count = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    input_tokens: count(u.input_tokens),
    output_tokens: count(u.output_tokens),
    cache_creation_tokens: count(u.cache_creation_input_tokens),
    cache_read_tokens: count(u.cache_read_input_tokens),
  };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : -1;
}
// tool_result content is a string or an array of {type:"text",text} parts.
// Bounded: results are display-only (never chained) and a raw file dump would
// bloat every transcript snapshot we persist and broadcast.
const TOOL_RESULT_MAX = 4000;
function toolResultText(content: unknown): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((p) => (rec(p).text !== undefined ? str(rec(p).text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return text.length > TOOL_RESULT_MAX
    ? text.slice(0, TOOL_RESULT_MAX) + "\n… (truncated)"
    : text;
}
