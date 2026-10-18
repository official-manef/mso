#!/usr/bin/env bash
# Read the entrypoint header without loading credentials or HTTP transport.
usage() { awk 'NR>1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"; }
