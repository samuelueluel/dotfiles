#!/usr/bin/env bash
# Dedicated Zotero figure VLM. Does not change the shared serve-vlm service.
# Uses the locally built ROCm llama-server and cached Qwen3-VL/BF16 projector.
# Start only for an approved enrichment run; stop promptly afterward.
set -euo pipefail

NAME="${ZOTERO_PIPELINE_VLM_NAME:-zotero-vlm-rocm}"
PORT="${ZOTERO_PIPELINE_VLM_PORT:-18084}"
IMAGE='localhost/llama-rocm-10.0-strix-llama:latest'
SNAPSHOTS="$HOME/.local/share/ramalama/store/huggingface/unsloth/Qwen3-VL-30B-A3B-Instruct-GGUF/snapshots"
MODEL_NAME='Qwen3-VL-30B-A3B-Instruct-UD-Q8_K_XL.gguf'
MMPROJ_NAME='mmproj-BF16.gguf'
ENDPOINT="http://127.0.0.1:${PORT}/v1/chat/completions"

if [[ ! "$NAME" =~ ^[a-z][a-z0-9_.-]*$ ]] || [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( 10#$PORT < 1024 || 10#$PORT > 65535 )); then
  echo 'Invalid dedicated VLM container name or loopback port.' >&2
  exit 2
fi

case "${1:-}" in
  start)
    if podman container exists "$NAME"; then
      echo "Container $NAME already exists; inspect status/logs before restarting." >&2
      exit 2
    fi
    podman image exists "$IMAGE" || { echo "Local ROCm image missing: $IMAGE; refusing a pull." >&2; exit 2; }
    shopt -s nullglob
    model_paths=()
    mmproj_paths=()
    for snapshot in "$SNAPSHOTS"/sha256-*; do
      [[ -f "$snapshot/$MODEL_NAME" && -f "$snapshot/$MMPROJ_NAME" ]] || continue
      model_paths+=("$snapshot/$MODEL_NAME")
      mmproj_paths+=("$snapshot/$MMPROJ_NAME")
    done
    if (( ${#model_paths[@]} != 1 )); then
      echo "Expected one cached matching model/projector snapshot, found ${#model_paths[@]}; refusing a guess or download." >&2
      exit 2
    fi
    podman run -d --pull=never --name "$NAME" \
      --device /dev/kfd --device /dev/dri --group-add keep-groups \
      --security-opt label=disable --log-driver=journald --log-opt "tag=$NAME" \
      -p "127.0.0.1:$PORT:$PORT" \
      -v "${model_paths[0]}:/mnt/model.gguf:ro" \
      -v "${mmproj_paths[0]}:/mnt/mmproj.gguf:ro" \
      "$IMAGE" /usr/local/bin/llama-server \
      --host 0.0.0.0 --port "$PORT" --model /mnt/model.gguf --mmproj /mnt/mmproj.gguf \
      --ctx-size 8192 -ngl 99 -fa on -b 2048 -ub 2048 -np 1 >/dev/null
    ready=false
    for _ in {1..120}; do
      if curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
        ready=true
        break
      fi
      if [[ "$(podman inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)" != true ]]; then
        break
      fi
      sleep 2
    done
    if [[ "$ready" != true ]]; then
      echo "Dedicated VLM did not become ready; retained $NAME for inspection." >&2
      podman logs --tail 25 "$NAME" >&2 || true
      exit 1
    fi
    echo "Dedicated ROCm figure VLM ready on loopback; run the approved batch with:"
    echo "  export ZOTERO_VLM_URL=$ENDPOINT"
    echo "Stop it after enrichment: zotero-vlm-rocm.sh stop"
    ;;
  status)
    if ! podman container exists "$NAME"; then
      echo "Dedicated VLM $NAME is not running." >&2
      exit 1
    fi
    podman ps -a --filter "name=^${NAME}$" --format '{{.Names}} {{.Status}}'
    if ! curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null; then
      echo "Dedicated VLM endpoint is not healthy; inspect: podman logs $NAME" >&2
      exit 1
    fi
    echo "Endpoint: $ENDPOINT"
    ;;
  stop)
    if podman container exists "$NAME"; then
      podman stop -t 10 "$NAME" >/dev/null || true
      podman rm "$NAME" >/dev/null
      echo "Stopped and removed only $NAME."
    else
      echo "Dedicated VLM $NAME is already absent."
    fi
    ;;
  *)
    echo 'usage: zotero-vlm-rocm.sh {start|status|stop}' >&2
    exit 2
    ;;
esac
