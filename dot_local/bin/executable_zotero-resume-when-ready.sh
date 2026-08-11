#!/usr/bin/env bash
# zotero-resume-when-ready.sh — polls every 5 min; when the CPU rescue of the
# 8 poison items finishes, auto-runs the documented resume path:
#   1) start the :8082 embedder (replicates serve-embedder)
#   2) launch zotero-backfill-watchdog.sh (fixed EMBED-HANG detection)
#   3) wait for the final backfill:true run to complete
#   4) flip semantic_search.mineru.backfill to false (incremental mode)
# Logs: ~/.cache/zotero-mcp/logs/auto-resume.log
set -u

LOG_DIR="$HOME/.cache/zotero-mcp/logs"
MON_LOG="$LOG_DIR/auto-resume.log"
RESCUE_LOG="$LOG_DIR/cpu-rescue.log"
RUN_LOG="$LOG_DIR/backfill-run.log"
CFG="$HOME/.config/zotero-mcp/config.json"
SIDECAR_DIR="$HOME/.config/zotero-mcp/mineru-sidecars"
FLAG="$LOG_DIR/auto-resume.started"

log() { echo "$(date '+%F %T') $*" | tee -a "$MON_LOG"; }

rescue_done() {
  grep -q "rescue complete" "$RESCUE_LOG" 2>/dev/null && return 0
  [ "$(ls "$SIDECAR_DIR" 2>/dev/null | wc -l)" -ge 92 ] \
    && ! pgrep -f zotero-cpu-rescue >/dev/null 2>&1 && return 0
  return 1
}

[ -f "$FLAG" ] && { log "already started before ($FLAG exists); exiting"; exit 0; }

log "watcher start: polling every 300s for rescue completion (sidecars now: $(ls "$SIDECAR_DIR" 2>/dev/null | wc -l)/92)"
while ! rescue_done; do
  log "wait: sidecars=$(ls "$SIDECAR_DIR" 2>/dev/null | wc -l)/92"
  sleep 300
done
log "RESCUE COMPLETE: sidecars=$(ls "$SIDECAR_DIR" 2>/dev/null | wc -l)/92 — starting resume"
touch "$FLAG"

# 1) embedder (replicates serve-embedder exactly)
log "starting embedder :8082"
podman pull docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv >/dev/null 2>&1 || true
ramalama stop embedder 2>/dev/null || true
ramalama serve -d -n embedder -p 8082 \
  --image docker.io/kyuz0/amd-strix-halo-toolboxes:vulkan-radv \
  --ctx-size 8192 --runtime-args="--embedding --parallel 1" \
  hf://Qwen/Qwen3-Embedding-8B-GGUF:Q8_0 >> "$MON_LOG" 2>&1
for i in $(seq 1 24); do
  curl -sf -m 3 http://localhost:8082/v1/models >/dev/null 2>&1 && break
  sleep 5
done
curl -s -m 3 -o /dev/null -w "embedder HTTP %{http_code}\n" http://localhost:8082/v1/models | tee -a "$MON_LOG"

# 2) watchdog (exits 0 itself when the run completes with 'Update completed')
log "launching watchdog"
setsid nohup "$HOME/.local/bin/zotero-backfill-watchdog.sh" > /dev/null 2>&1 < /dev/null &
WATCH_PID=$!
log "watchdog pid $WATCH_PID"

# 3) wait for the final backfill run (up to 8 h)
log "waiting for final backfill run (watchdog exit or 'Update completed')"
for i in $(seq 1 96); do
  if ! kill -0 "$WATCH_PID" 2>/dev/null; then
    log "watchdog exited (pid $WATCH_PID) — run finished"
    break
  fi
  grep -q "Database update completed:" "$RUN_LOG" 2>/dev/null && { log "run log shows 'Database update completed:'"; break; }
  sleep 300
done

# 4) flip backfill to false (with a backup)
if grep -q '"backfill": *true' "$CFG"; then
  cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
  python3 - "$CFG" <<'PY'
import json, sys
p = sys.argv[1]
cfg = json.load(open(p))
cfg["semantic_search"]["mineru"]["backfill"] = False
json.dump(cfg, open(p, "w"), indent=2)
print("backfill -> false")
PY
  log "flipped semantic_search.mineru.backfill to false in $CFG"
else
  log "backfill already false (or pattern not found) — no change"
fi

log "AUTO-RESUME COMPLETE: backfill finished, backfill=false, incremental mode on. Embedder left running for query-time embeddings."
