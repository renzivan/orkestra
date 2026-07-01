#!/usr/bin/env bash
# Fake model CLI that blocks, so a run can be stopped mid-step. Records each
# invocation to the counter file passed as $1 (lets tests assert a killed step
# is not retried), drains stdin, then sleeps until killed.
counter="$1"
echo x >> "$counter"
cat >/dev/null
# exec so this process *becomes* sleep: a SIGTERM from the runner kills it
# directly and closes stdout (no orphaned child left holding the pipe open).
exec sleep 30
