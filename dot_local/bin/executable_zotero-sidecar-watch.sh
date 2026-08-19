#!/usr/bin/env bash
# zotero-sidecar-watch.sh — GTT balloon + hang watchdog for sidecar-create runs.
#
# Reuses the calibrated GTT detection from zotero-backfill-watchdog.sh
# (default threshold 105 GB, 3 bad samples @ 20s cadence, SIGKILL magic-pdf
# children ONLY) but targets zotero-sidecar-create.py instead of update-db,
# so the parse-only pipeline gets the same balloon protection WITHOUT the
# update-db/embedder coupling.
#
# On a genuine balloon: magic-pdf is SIGKILLed, create.py logs "FAIL <key>"
# and moves to the next item; the ballooned item is CPU-rescued later
# (zotero-cpu-rescue.py — CPU venv is balloon-immune, byte-identical sidecar).
#
# Threshold rationale (from the watchdog's calibration): legit GTT sits at
# ~12-30 GB with nothing loaded and ~73-103 GB with VLM+embedder+reranker in
# unified memory; a genuine balloon jumps to ~114-124 GB. 105 GB default sits
# in the gap — no false-positive risk in either state.
#
# Also logs heartbeats + RAM/swap forensics every ~3.5 min so a recurrence
# leaves a post-mortem trail instead of a mystery.
#
# Usage:
#   zotero-sidecar-watch.sh                          # watch until create exits
#   WATCHDOG_GTT_THRESHOLD_MB=<MB> zotero-sidecar-watch.sh
#   ITEM_TIMEOUT_SEC=<sec> zotero-sidecar-watch.sh   # per-item wall-clock (default 3600)

set -u

LOG_DIR="$HOME/.cache/zotero-mcp/logs"
WATCH_LOG="$LOG_DIR/sidecar-watch.log"
CREATE_LOG="$LOG_DIR/sidecar-create.log"
GTT="/sys/class/drm/card1/device/mem_info_gtt_used"

GTT_THRESHOLD_MB=${WATCHDOG_GTT_THRESHOLD_MB:-$((105 * 1024))}
GTT_BAD_SAMPLES=3
ITEM_TIMEOUT_SEC=${ITEM_TIMEOUT_SEC:-3600}     # 60 min (item 1 = 869pp took ~31 min)
SLEEP_SEC=20

mkdir -p "$LOG_DIR"
log() { echo "$(date '+%F %T') $*" >> "$WATCH_LOG"; }

gtt_mb() { [ -r "$GTT" ] && echo $(( $(cat "$GTT") / 1024 / 1024 )) || echo 0; }

current_item() {
  grep -o "start [A-Z0-9]\{8\}:" "$CREATE_LOG" 2>/dev/null | tail -1 | awk '{print $2}' | tr -d ':'
}

item_started_since() {
  # seconds since the last "start <KEY>:" line (from the log's own timestamp)
  local line t
  line=$(grep -oE "^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} .*start [A-Z0-9]{8}:" "$CREATE_LOG" 2>/dev/null | tail -1)
  [ -z "$line" ] && { echo 999999; return; }
  t=$(date -d "${line:0:19}" +%s 2>/dev/null) || { echo 999999; return; }
  echo $(( $(date +%s) - t ))
}

magic_pdf_alive() { pgrep -f "bin/magic-pdf" >/dev/null 2>&1 || pgrep -f "bin/mineru" >/dev/null 2>&1; }
create_alive()   { pgrep -f "zotero-sidecar-create.py" >/dev/null 2>&1; }

kill_magic_pdf() {
  pkill -9 -f "bin/magic-pdf" 2>/dev/null
  pkill -9 -f "bin/mineru" 2>/dev/null
  sleep 2
}

log "=== sidecar-watch start (gtt_threshold=${GTT_THRESHOLD_MB}MB, item_timeout=${ITEM_TIMEOUT_SEC}s) ==="
LAST_ITEM=""; BAD_GTT=0; HB=0; POISON=()

while true; do
  sleep "$SLEEP_SEC"
  G=$(gtt_mb)
  ITEM=$(current_item)
  ALIVE_MD=$(magic_pdf_alive && echo yes || echo no)

  if [ "$ITEM" != "$LAST_ITEM" ]; then
    LAST_ITEM="$ITEM"; LAST_ITEM_SINCE=$(date +%s)
    log "item: [$ITEM]"
  fi

  # GTT balloon detection (same logic as backfill-watchdog)
  if [ "$G" -gt "$GTT_THRESHOLD_MB" ]; then
    BAD_GTT=$((BAD_GTT + 1))
    log "gtt=${G}MB (bad sample ${BAD_GTT}/${GTT_BAD_SAMPLES}) item [$ITEM]"
  else
    BAD_GTT=0
  fi
  if [ "$BAD_GTT" -ge "$GTT_BAD_SAMPLES" ]; then
    log "BALLOON: gtt=${G}MB at item [$ITEM] — killing magic-pdf (create logs FAIL, CPU-rescue later)"
    kill_magic_pdf
    BAD_GTT=0
    [[ " ${POISON[*]} " != *" $ITEM "* ]] && POISON+=("$ITEM")
  fi

  # Per-item wall-clock hang guard (only while magic-pdf is alive)
  ITEM_SINCE=$(item_started_since)
  if [ "$ALIVE_MD" = "yes" ] && [ "$ITEM_SINCE" -gt "$ITEM_TIMEOUT_SEC" ]; then
    log "HANG: item [$ITEM] running >${ITEM_TIMEOUT_SEC}s with magic-pdf alive — killing"
    kill_magic_pdf
  fi

  # RAM/swap forensics (log-only — never kills on low RAM)
  FREE_MB=$(awk '/MemAvailable/ {printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null)
  SWAP_MB=$(awk '/SwapTotal/ {t=$2} /SwapFree/ {f=$2} END {printf "%.0f", (t-f)/1024}' /proc/meminfo 2>/dev/null)
  if [ "${FREE_MB:-999999}" -lt 8192 ] || [ "${SWAP_MB:-0}" -gt 8192 ]; then
    log "WARN-RAM: free=${FREE_MB}MB swap=${SWAP_MB}MB gtt=${G}MB item [$ITEM] — top RSS:"
    ps aux --sort=-rss | head -6 | tail -5 | awk '{printf "  %6s MB %s %s\n", int($6/1024), $11, $12}' >> "$WATCH_LOG"
  fi

  # Heartbeat every ~3.5 min
  HB=$((HB + 1))
  if [ $((HB % 10)) -eq 0 ]; then
    log "hb: alive_md=${ALIVE_MD} gtt=${G}MB free=${FREE_MB}MB swap=${SWAP_MB}MB item=[$ITEM]"
  fi

  # Lifecycle: exit when create.py is gone
  if ! create_alive; then
    if magic_pdf_alive; then
      log "create exited but magic-pdf still running — killing"
      kill_magic_pdf
    fi
    log "=== WATCH DONE ==="
    log "poison items (need CPU rescue): ${POISON[*]:-none}"
    log "sidecar count: $(ls "$HOME/.config/zotero-mcp/mineru-sidecars" 2>/dev/null | wc -l)"
    exit 0
  fi
done
