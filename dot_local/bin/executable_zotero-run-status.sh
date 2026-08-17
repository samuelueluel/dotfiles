#!/usr/bin/env bash
# zotero-run-status.sh — live commit-event + status monitor for update-db runs.
#
# Polls per-item ChromaDB chunk counts and logs COMMIT events the moment a
# flush lands (flushes can cover SEVERAL in-flight items at once — never assume
# per-item commits), plus the embedder's live task counter, process liveness,
# and GPU busy. Writes a current-status file overwritten every poll, so "what's
# happening right now" is one cat away.
#
# Usage:  zotero-run-status.sh <ITEMKEY...>
#         POLL_SEC=15 zotero-run-status.sh KEY1 KEY2 ...   (default 30s)
#
# Self-exits when watchdog + update-db are both dead (normal completion or a
# deliberate pause-kill) after writing the final state.
#
# Logs: ~/.cache/zotero-mcp/logs/run-status.log (append, events + status lines)
#       ~/.cache/zotero-mcp/logs/run-status.txt (overwrite, current status)
set -u
PY="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/python"
CFG="$HOME/.config/zotero-mcp/config.json"
LOG_DIR="$HOME/.cache/zotero-mcp/logs"
STATUS_FILE="$LOG_DIR/run-status.txt"
POLL="${POLL_SEC:-30}"
KEYS="$*"
[ -n "$KEYS" ] || { echo "usage: zotero-run-status.sh <ITEMKEY...>" >&2; exit 1; }

log() { echo "$(date '+%F %T') $*" >>"$LOG_DIR/run-status.log"; }
# bracket tricks so pgrep never matches our own cmdline context
wd_alive() { local n; n=$(pgrep -fc "zotero-backfill-watchdo[g]" 2>/dev/null || true); echo "${n:-0}"; }
ud_alive() { local n; n=$(pgrep -fc "update-db --fulltex[t]" 2>/dev/null || true); echo "${n:-0}"; }

prev=""
first=1
log "monitor start: keys = $KEYS (poll ${POLL}s)"

while true; do
  now=$(date '+%F %T')
  # per-key counts (one python call per poll; local chroma, cheap)
  counts=$("$PY" - "$CFG" $KEYS <<'EOF' 2>/dev/null
import sys
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
cfg = sys.argv[1]
keys = sys.argv[2:]
col = create_chroma_client(str(Path(cfg))).collection
for k in keys:
    try:
        n = len(col.get(where={"item_key": k}, include=[])["ids"])
    except Exception:
        n = -1
    print(f"{k}={n}")
EOF
)
  [ -z "$counts" ] && counts="(chroma read failed)"
  tot=0; done_keys=0; pending=()
  for line in $counts; do
    k=${line%%=*}; n=${line##*=}; n=${n:-0}
    [ "$n" -gt 0 ] && { tot=$((tot + n)); done_keys=$((done_keys + 1)); } || pending+=("$k")
  done

  # commit-event detection (skip on first poll so baseline is not a "commit")
  if [ $first -eq 0 ] && [ -n "$prev" ]; then
    for line in $counts; do
      k=${line%%=*}; n=${line##*=}; n=${n:-0}
      p=$(echo "$prev" | tr ' ' '\n' | grep "^$k=" | cut -d= -f2)
      p=${p:-0}
      if [ "$n" -gt "$p" ]; then
        log "COMMIT: $k +$((n - p)) chunks -> $n total"
      fi
    done
  fi
  prev="$counts"

  task=$(podman logs --tail 5 embedder 2>&1 | grep -oE '(task [0-9]+|id_task = [0-9]+)' | grep -oE '[0-9]+' | tail -1)
  gpu=$(cat /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null | head -1)
  wd=$(wd_alive); ud=$(ud_alive)
  nkeys=$(echo $KEYS | wc -w)

  status="$now committed=$done_keys/$nkeys chunks=$tot in-flight/pending=${pending[*]:-none} task=${task:-?} wd=$wd ud=$ud gpu=${gpu:-?}%"
  log "STATUS: $status"
  echo "$status" >"$STATUS_FILE"

  if [ "$wd" -eq 0 ] && [ "$ud" -eq 0 ]; then
    if [ $first -eq 0 ]; then
      log "monitor: watchdog + update-db both dead — final state (paused or complete); exiting"
      echo "FINAL: $status" >>"$STATUS_FILE"
      # [2026-08-16] store-health check after any stop: a SIGKILL mid-flush can
      # corrupt the hnsw segments (observed: segfaults on every access). Open +
      # count to verify the store survives; CORRUPT means resume must rebuild.
      health=$("$PY" - "$CFG" <<'EOF2' 2>/dev/null
import sys, time
from pathlib import Path
import chromadb
from chromadb.config import Settings
p = str(Path(sys.argv[1]).parent / "chroma_db")
if not Path(p).exists():
    print("store-absent"); raise SystemExit
c = chromadb.PersistentClient(path=p, settings=Settings(anonymized_telemetry=False, allow_reset=True))
col = c.get_collection("zotero_library")
print(f"store-health: OK count={col.count()}")
EOF2
)
      health=${health:-store-health: CORRUPT (open/count failed)}
      log "$health"
      echo "$health" >>"$STATUS_FILE"
      exit 0
    fi
  fi
  first=0
  sleep "$POLL"
done
