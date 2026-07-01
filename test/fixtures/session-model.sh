#!/usr/bin/env bash
# Fake Claude-style CLI that emits a stable session_id and echoes its stdin back
# as the answer text. Lets tests exercise session capture + reply/resume without
# the real CLI. (Keep test inputs simple — no quotes/newlines — so the JSON stays
# valid.)
in="$(cat)"
sid="sess-123"
printf '{"type":"system","subtype":"init","session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"message_start"},"session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"echo:%s"}},"session_id":"%s"}\n' "$in" "$sid"
printf '{"type":"result","subtype":"success","session_id":"%s"}\n' "$sid"
