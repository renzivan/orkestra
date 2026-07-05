#!/usr/bin/env bash
# Fake Claude-style CLI that emits a short answer plus a final result line
# carrying token usage. Lets tests prove the runner captures per-step usage.
cat >/dev/null
printf '%s\n' '{"type":"system","subtype":"init"}'
printf '%s\n' '{"type":"stream_event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}'
printf '%s\n' '{"type":"result","subtype":"success","usage":{"input_tokens":11,"output_tokens":22,"cache_creation_input_tokens":3,"cache_read_input_tokens":4}}'
