#!/usr/bin/env bash
# Fake model CLI for engine tests: reads stdin, prints a deterministic transform
# that encodes the args it was given and the input it received.
input="$(cat)"
echo "OUT[$*]:$input"
