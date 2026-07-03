#!/usr/bin/env bash
# Fake Claude-style CLI that emits a stable session_id, echoes its stdin, and
# tags the answer with whether it was invoked with --resume. Lets tests assert
# that resuming a stopped run actually passes the captured session through to the
# CLI (tag "resumed:") rather than cold-restarting it (tag "fresh:").
in="$(cat)"
sid="sess-123"
tag="fresh"
for a in "$@"; do [ "$a" = "--resume" ] && tag="resumed"; done
printf '{"type":"system","subtype":"init","session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"message_start"},"session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"%s"}\n' "$sid"
printf '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"%s:%s"}},"session_id":"%s"}\n' "$tag" "$in" "$sid"
printf '{"type":"result","subtype":"success","session_id":"%s"}\n' "$sid"
