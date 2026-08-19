#!/usr/bin/env bash
# zotero-backfill-watchdog.sh — self-healing runner for the MinerU library backfill.
#
# WHY: on this APU (133 GB unified memory), magic-pdf on the ROCm GPU path can
# trigger an amdgpu GTT balloon (driver commits ~all free RAM as GTT) when MFR
# hits a specific formula batch (deterministic per PDF, e.g. Gregory PDF item
# 347KLNEW → 124 GB at MFR formula #256/395). The machine then swap-thrashes.
# The CPU venv path is immune (verified: same PDF completes at ~3 GB RSS).
#
# Strategy: run the normal GPU backfill, but watch GTT + per-item wall time.
# On a balloon/hang, SIGKILL only the magic-pdf child — the update-db parent
# falls back to text-layer extraction for that item (sidecar-less → can be
# CPU-rescued later) and continues. The run is resumable: sidecars cache at
# ~/.config/zotero-mcp/mineru-sidecars/<key>.md, so restarts never re-parse.
#
# Usage: zotero-backfill-watchdog.sh [--limit N]   (restartable; run under nohup/setsid)

set -u

LOG_DIR="$HOME/.cache/zotero-mcp/logs"
RUN_LOG="$LOG_DIR/backfill-run.log"
WATCH_LOG="$LOG_DIR/backfill-watchdog.log"
SIDECAR_DIR="$HOME/.config/zotero-mcp/mineru-sidecars"
GTT="/sys/class/drm/card1/device/mem_info_gtt_used"
# Real amdgpu GTT balloon jumps GTT toward ~all free RAM (Gregory PDF → 124 GB
# from a ~10 GB baseline). 2026-08-19: with the VLM (Qwen3-VL-30B-A3B, ~36 GB) + reranker + embedder
# loaded in unified memory, baseline GTT is ~73 GB — the old fixed 50 GB
# threshold falsely SIGKILLed every magic-pdf parse. Now env-configurable;
# default 105 GB sits above legit usage in both states (~30 GB no-VLM, ~103 GB
# with VLM) and below a genuine balloon (~114-124 GB). Override per-run with
# WATCHDOG_GTT_THRESHOLD_MB=<MB> (e.g. when other GTT-heavy workloads run).
GTT_THRESHOLD_MB=${WATCHDOG_GTT_THRESHOLD_MB:-$((105 * 1024))}
GTT_BAD_SAMPLES=3                      # ~60s of confirmed balloon before killing
ITEM_TIMEOUT_SEC=2700                  # 45 min per item (Dixit-class scans ~30 min legit)
SLEEP_SEC=20
LIMIT="${1:-}"

BIN="$HOME/.local/share/uv/tools/zotero-mcp-server/bin/zotero-mcp-server"
export ZOTERO_LOCAL=true
# API key read at runtime from the systemd unit (never hardcoded/committed).
# Same pattern as zotero-link; the unit is NOT chezmoi-tracked and stays chmod 600.
UNIT="$HOME/.config/systemd/user/zotero-mcp.service"
export ZOTERO_API_KEY=$(grep -oP 'ZOTERO_API_KEY=\K[^" ]+' "$UNIT" 2>/dev/null | head -1)
export ZOTERO_LIBRARY_ID=$(grep -oP 'ZOTERO_LIBRARY_ID=\K[^" ]+' "$UNIT" 2>/dev/null | head -1)
if [ -z "$ZOTERO_API_KEY" ] || [ -z "$ZOTERO_LIBRARY_ID" ]; then
  echo "error: could not read Zotero API creds from $UNIT" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
log() { echo "$(date '+%F %T') $*" >> "$WATCH_LOG"; }

gtt_mb() { [ -r "$GTT" ] && echo $(( $(cat "$GTT") / 1024 / 1024 )) || echo 0; }

current_item() {
  tail -c 8000 "$RUN_LOG" 2>/dev/null | tr '\r' '\n' \
    | grep -o "Processing [0-9]*/[0-9]* — [^ ]*" | tail -1
}

magic_pdf_alive() { pgrep -f "bin/magic-pdf" >/dev/null 2>&1; }

# Instantaneous CPU % over 4s (ps %CPU is a lifetime average — useless here).
# 999 = unknown/missing process (treated as "cannot confirm idle").
cpu_now() {
  local pid="$1" t1 t2
  [ -n "$pid" ] || { echo 999; return; }
  t1=$(awk '{print $14+$15}' "/proc/$pid/stat" 2>/dev/null) || { echo 999; return; }
  sleep 4
  t2=$(awk '{print $14+$15}' "/proc/$pid/stat" 2>/dev/null) || { echo 999; return; }
  echo $(( (t2 - t1) * 100 / 400 ))
}

kill_children() {
  pkill -9 -f "bin/magic-pdf" 2>/dev/null
  sleep 2
}

start_run() {
  local args="--fulltext"
  [ -n "$LIMIT" ] && args="$args --limit $LIMIT"
  # Optional scoping: WATCHDOG_CONFIG=<path to scoped config> restricts the
  # update-db pool to semantic_search.collection_keys from that config file,
  # so pipeline runs never touch items outside their collection (added 2026-08-15
  # for the Detroit-Paper driver; harmless when unset).
  if [ -n "${WATCHDOG_CONFIG:-}" ]; then
    args="$args --config-path $WATCHDOG_CONFIG"
    log "scoped config: $WATCHDOG_CONFIG"
  fi
  log "starting: zotero-mcp-server update-db $args"
  # faulthandler: print a native traceback if a C-level crash kills update-db
  PYTHONFAULTHANDLER=1 setsid nohup "$BIN" update-db $args >> "$RUN_LOG" 2>&1 < /dev/null &
  RUN_PID=$!
  log "update-db pid $RUN_PID"
}

# Fresh log for this watchdog session (keep the killed run's log aside)
[ -f "$RUN_LOG" ] && cp "$RUN_LOG" "$RUN_LOG.$(date +%H%M%S).prev" 2>/dev/null
: > "$RUN_LOG"
log "=== watchdog session start (gtt_threshold=${GTT_THRESHOLD_MB}MB, item_timeout=${ITEM_TIMEOUT_SEC}s) ==="

start_run
LAST_ITEM=""; LAST_ITEM_SINCE=$(date +%s); BAD_GTT=0; HB=0; LAST_FAILED_CNT=0; STUCK_EMB=0; LAST_EMB_TASK=""; HB_TASK_LAST=""
POISON=()

last_run_log_write=$(date +%s)

while true; do
  sleep "$SLEEP_SEC"
  G=$(gtt_mb)
  ITEM=$(current_item)
  ALIVE_MD=$(magic_pdf_alive && echo yes || echo no)

  # Detect an embedding-phase hang: run log stale AND embedder idle AND no
  # magic-pdf (parse phase). A legitimately large batch can keep the log
  # stale for ~10-25 min, but then llama-server CPU is high — the hang
  # signature is a stale log with the embedder at ~0% CPU (deadlocked worker
  # or pasta stall). Recovery: restart embedder + kill update-db (watchdog
  # restarts it; ChromaDB upserts are idempotent).
  NOW_S=$(date +%s)
  RUN_LOG_MTIME=$(stat -c %Y "$RUN_LOG" 2>/dev/null || echo "$NOW_S")
  # Measure BOTH engines: the embedder (llama-server) and any magic-pdf.
  # A straggler magic-pdf from the extraction tail used to suppress detection
  # entirely (old gate: ALIVE_MD=no); a stuck parse is itself a hang.
  EMB_PID=$(pgrep -f llama-server | tail -1)
  MD_PID=$(pgrep -f "bin/magic-pdf" | tail -1)
  EMB_CPU=$(cpu_now "$EMB_PID")
  MD_CPU=$(cpu_now "$MD_PID")
  # Ground-truth liveness: llama-server's own task counter advances per
  # embedded chunk. A single 4s CPU sample is NOT sufficient — llama-server
  # is bursty (0% between HTTP requests) and the run log is legitimately
  # silent during the embedding phase of an embed-only run, so one 0% sample
  # false-killed healthy runs three times on 2026-08-14/15 (21:43, 23:13, 00:07).
  # llama-server logs to STDERR only — 2>&1 is required or the counter is always empty
  EMB_TASK=$(podman logs --tail 1 embedder 2>&1 | grep -o 'task [0-9]*' | grep -o '[0-9]*' | tail -1)
  EMB_TASK_MOVED=0
  [ "$EMB_TASK" != "$LAST_EMB_TASK" ] && EMB_TASK_MOVED=1
  # Embedding-phase hang: run log stale AND embedder idle AND task counter
  # not moved this iteration, for 3+ consecutive iterations (~60s+). The
  # 600s post-restart grace (last_run_log_write reset) gives a freshly
  # restarted embedder time to reload before this can re-fire.
  if kill -0 "$RUN_PID" 2>/dev/null \
     && [ $((NOW_S - RUN_LOG_MTIME)) -gt 600 ] \
     && [ $((NOW_S - last_run_log_write)) -gt 600 ] \
     && [ "$EMB_CPU" -lt 5 ] \
     && [ "$EMB_TASK_MOVED" -eq 0 ] \
     && { [ -z "$MD_PID" ] || [ "$MD_CPU" -lt 5 ]; }; then
    STUCK_EMB=$((STUCK_EMB + 1))
  else
    STUCK_EMB=0
  fi
  LAST_EMB_TASK="$EMB_TASK"
  if [ "$STUCK_EMB" -ge 3 ]; then
    log "EMBED-HANG: run log stale $((NOW_S - RUN_LOG_MTIME))s, embedder cpu=${EMB_CPU}% task=${EMB_TASK} stuck ${STUCK_EMB} loops — restarting embedder + update-db"
    podman restart embedder 2>/dev/null
    kill_children
    kill "$RUN_PID" 2>/dev/null
    last_run_log_write=$NOW_S
    STUCK_EMB=0
  fi
  # keep last_run_log_write fresh when the log is moving
  [ "$RUN_LOG_MTIME" -gt "$last_run_log_write" ] && last_run_log_write=$RUN_LOG_MTIME

  # Slow-crawl variant: embedder is BUSY (not the 0% deadlock above) but
  # upserts keep failing/timing out, so update-db logs 'saving for retry'
  # lines and progress crawls. Healthy runs log ~0 of these; the wedged
  # 16:57 container accumulated hundreds while looking healthy by CPU/GPU.
  FAILED_CNT=$(grep -cE "saving for retry|Error upserting" "$RUN_LOG" 2>/dev/null || echo 0)
  if [ "$FAILED_CNT" -ge 5 ] \
     && [ "$FAILED_CNT" -gt "$LAST_FAILED_CNT" ] \
     && kill -0 "$RUN_PID" 2>/dev/null; then
    log "EMBED-CRAWL: ${FAILED_CNT} upsert failures accumulating (was ${LAST_FAILED_CNT}) — embedder wedged (slow-crawl) — restarting embedder + update-db"
    podman restart embedder 2>/dev/null
    kill_children
    kill "$RUN_PID" 2>/dev/null
    last_run_log_write=$NOW_S
  fi
  LAST_FAILED_CNT=$FAILED_CNT

  # Heartbeat (~every 10th iteration ≈ 5 min) for post-mortem diagnosis
  HB=$((HB + 1))
  if [ $((HB % 10)) -eq 0 ]; then
    # [2026-08-16] live signals: the embedder task counter advances per chunk
    # (item=[...] is a stale capture during the embed phase — read task_delta).
    TASK_DELTA=$(( ${EMB_TASK:-0} - ${HB_TASK_LAST:-${EMB_TASK:-0}} ))
    HB_TASK_LAST="${EMB_TASK}"
    log "hb: alive_md=${ALIVE_MD} emb_cpu=${EMB_CPU}% md_cpu=${MD_CPU}% upsert_fails=${FAILED_CNT} gtt=${G}MB task=${EMB_TASK:-?} task_delta=${TASK_DELTA} runlog_age=$((NOW_S - RUN_LOG_MTIME))s item=[$ITEM]"
  fi


  if [ "$ITEM" != "$LAST_ITEM" ]; then
    LAST_ITEM="$ITEM"; LAST_ITEM_SINCE=$(date +%s)
    log "item: [$ITEM]"
  fi

  # GTT balloon detection
  if [ "$G" -gt "$GTT_THRESHOLD_MB" ]; then
    BAD_GTT=$((BAD_GTT + 1))
    log "gtt=${G}MB (bad sample ${BAD_GTT}/${GTT_BAD_SAMPLES}) item [$ITEM]"
  else
    BAD_GTT=0
  fi
  if [ "$BAD_GTT" -ge "$GTT_BAD_SAMPLES" ]; then
    log "BALLOON: gtt=${G}MB at item [$ITEM] — killing magic-pdf (item falls back to text-layer)"
    kill_children
    BAD_GTT=0
    [[ " ${POISON[*]} " != *" $ITEM "* ]] && POISON+=("$ITEM")
  fi

  # Per-item wall-clock hang protection (only when magic-pdf is alive)
  if [ "$ALIVE_MD" = "yes" ] && [ $(( $(date +%s) - LAST_ITEM_SINCE )) -gt "$ITEM_TIMEOUT_SEC" ]; then
    log "HANG: item [$ITEM] running >${ITEM_TIMEOUT_SEC}s with magic-pdf alive — killing"
    kill_children
    LAST_ITEM_SINCE=$(date +%s)
  fi

  # update-db lifecycle
  if ! kill -0 "$RUN_PID" 2>/dev/null; then
    if magic_pdf_alive; then
      log "update-db died but magic-pdf still running — kill + restart"
      kill_children
      start_run
    elif grep -q "Database update completed:" "$RUN_LOG"; then
      log "=== BACKFILL COMPLETE ==="
      log "poison items (text-layer fallback, need CPU rescue): ${POISON[*]:-none}"
      log "sidecar count: $(ls "$SIDECAR_DIR" 2>/dev/null | wc -l)"
      exit 0
    else
      log "update-db exited unexpectedly (pid $RUN_PID) without 'Update completed' — restarting"
      start_run
    fi
  fi
done
