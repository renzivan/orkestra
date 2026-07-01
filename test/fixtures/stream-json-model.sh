#!/usr/bin/env bash
# Fake model CLI emitting Claude-style stream-json JSONL: a message with a text
# content block streamed as deltas (with delays), plus noise lines the parser
# must drop. Lets tests prove output surfaces incrementally as clean text.
cat >/dev/null
printf '%s\n' '{"type":"system","subtype":"init"}'
printf '%s\n' '{"type":"stream_event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}'
for word in one two three; do
  printf '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"%s "}}}\n' "$word"
  sleep 0.05
done
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}'
printf '%s\n' '{"type":"result","subtype":"success"}'
