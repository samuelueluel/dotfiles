#!/usr/bin/env bash
# Env in: PROMPT_FILE, LOG_FILE, DONE_FILE, MODEL_FLAG, WORKER_AGENT_DIR, DELEGATION_COUNT
set -o pipefail
# Persist the raw JSONL trace: the parent (spawn-subagent.ts) deletes LOG_FILE in its finally
# block, so without this every worker run would vanish. Archive survives for post-hoc review.
ARCHIVE_DIR="$HOME/.pi/orch-logs"
mkdir -p "$ARCHIVE_DIR"
ARCHIVE="$ARCHIVE_DIR/$(date +%Y%m%d-%H%M%S)-delegation-${DELEGATION_COUNT:-x}.jsonl"
SAFE_LEVEL=""
SAFE_TARGET=""
if [[ -f "$HOME/.pi/orch-safe-level" && -f "$HOME/.pi/orch-safe-target" ]]; then
  SAFE_LEVEL=$(cat "$HOME/.pi/orch-safe-level")
  SAFE_TARGET=$(cat "$HOME/.pi/orch-safe-target")
fi

if [[ -n "$SAFE_LEVEL" && -n "$SAFE_TARGET" ]]; then
  # Containerized worker
  PODMAN_ARGS=(--init -i --rm --network=host --userns=keep-id --security-opt label=disable
    -e HOME="$HOME" -e TERM -e COLORTERM -e LANG -e OPENROUTER_API_KEY
    -e PI_CODING_AGENT_DIR="$WORKER_AGENT_DIR" -e PI_IS_SUBAGENT=1
    -v "$HOME/.pi":"$HOME/.pi"
    -v "$HOME/.agents":"$HOME/.agents":ro
    -v "$PROMPT_FILE":"$PROMPT_FILE":ro)
  
  if [[ "$SAFE_LEVEL" == "1" ]]; then
    PODMAN_ARGS+=(-v "$HOME":"$HOME":ro -v "$SAFE_TARGET":"$SAFE_TARGET" -w "$SAFE_TARGET")
  elif [[ "$SAFE_LEVEL" == "2" ]]; then
    PODMAN_ARGS+=(-v "$SAFE_TARGET":"$SAFE_TARGET" -w "$SAFE_TARGET")
  elif [[ "$SAFE_LEVEL" == "3" ]]; then
    DIR=$(dirname "$SAFE_TARGET")
    PODMAN_ARGS+=(-v "$SAFE_TARGET":"$SAFE_TARGET" --tmpfs /tmp -w "$DIR")
  fi

  podman run "${PODMAN_ARGS[@]}" localhost/pi-safe:latest $MODEL_FLAG --mode json -p -a --no-session -xt ask_user @"$PROMPT_FILE" < /dev/null 2>&1 \
    | tee "$LOG_FILE" "$ARCHIVE" \
    | node "$HOME/.pi/worker-render.mjs"
else
  # Native host worker
  PI_CODING_AGENT_DIR="$WORKER_AGENT_DIR" PI_IS_SUBAGENT=1 \
    pi $MODEL_FLAG --mode json -p -a --no-session -xt ask_user @"$PROMPT_FILE" < /dev/null 2>&1 \
    | tee "$LOG_FILE" "$ARCHIVE" \
    | node "$HOME/.pi/worker-render.mjs"
fi

echo "${PIPESTATUS[0]}" > "$DONE_FILE"
