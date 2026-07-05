#!/usr/bin/env bash
# Fake Claude-style CLI for retry tests: counts invocations in $1. The first
# attempt reports usage then exits non-zero (forcing a retry); the second
# reports DIFFERENT usage and succeeds. Proves a retried step keeps the final
# (successful) attempt's usage, not the first attempt's and not a sum.
counter="$1"
cat >/dev/null
echo x >>"$counter"
n=$(wc -l <"$counter" | tr -d ' ')
printf '%s\n' '{"type":"stream_event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}}'
if [ "$n" -eq 1 ]; then
  # first attempt: report usage, then fail
  printf '%s\n' '{"type":"result","subtype":"error","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":1,"cache_read_input_tokens":1}}'
  exit 1
fi
# retry: different usage, succeed
printf '%s\n' '{"type":"result","subtype":"success","usage":{"input_tokens":50,"output_tokens":60,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}'
