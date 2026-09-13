#!/usr/bin/env bash
set -euo pipefail

patterns=(
  "zotero-backfill-watchdog"
  "zotero-sidecar-watch"
  "update-db"
  "mineru"
)

confirm=false
if [[ ${1:-} == "--confirm" ]]; then
  confirm=true
elif [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--confirm]" >&2
  exit 2
fi

for pattern in "${patterns[@]}"; do
  echo "== $pattern =="
  pgrep -af -- "$pattern" || true
done

if [[ $confirm != true ]]; then
  echo "Dry run only. Inspect the process list, then rerun with --confirm." >&2
  exit 0
fi

for pattern in "${patterns[@]}"; do
  pkill -f -- "$pattern" || true
done
