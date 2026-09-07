#!/usr/bin/env bash
# Music Agent: dedicated local Pi session with music skill and Last.fm MCP
set -euo pipefail

MODEL_PICKER="${PI_LOCAL_MODEL_PICKER:-$HOME/.local/bin/pi-pick-local-model}"
MODEL_LOADER="${PI_LOCAL_MODEL_LOADER:-$HOME/.local/bin/lem-load-model}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/pi/music-agent-local"
MODEL_FILE="$STATE_DIR/model"

command -v "$MODEL_PICKER" >/dev/null 2>&1 || {
  printf 'Local Music Agent: model picker not found: %s\n' "$MODEL_PICKER" >&2
  exit 1
}
command -v "$MODEL_LOADER" >/dev/null 2>&1 || {
  printf 'Local Music Agent: model loader not found: %s\n' "$MODEL_LOADER" >&2
  exit 1
}

model_id=""
if [[ -s "$MODEL_FILE" ]]; then
  model_id=$(<"$MODEL_FILE")
  if ! "$MODEL_PICKER" --validate "$model_id"; then
    model_id=""
    rm -f "$MODEL_FILE"
  fi
fi

if [[ -z "$model_id" ]]; then
  model_id=$("$MODEL_PICKER") || exit 1
  [[ -n "$model_id" ]] || exit 1
fi

# Use the shared loader so local model startup gets the same Lemonade/gum menus
# and runtime settings as the ordinary pi command. No cloud model is a fallback.
"$MODEL_LOADER" "$model_id"

if [[ ! -s "$MODEL_FILE" || "$(<"$MODEL_FILE")" != "$model_id" ]]; then
  mkdir -p "$STATE_DIR"
  tmp_model_file=$(mktemp "$STATE_DIR/model.XXXXXX")
  trap 'rm -f "${tmp_model_file:-}"' EXIT
  chmod 600 "$tmp_model_file"
  printf '%s\n' "$model_id" > "$tmp_model_file"
  mv -f "$tmp_model_file" "$MODEL_FILE"
  trap - EXIT
fi

PI_STATE_DIR="$HOME/.pi/running"
mkdir -p "$PI_STATE_DIR"
STATE_FILE="$PI_STATE_DIR/$$.state"
export PI_STATE_FILE="$STATE_FILE"
printf 'type=pi\nmodel=local/%s\nthinking=max\ncwd=Music\nsandbox=unsandboxed\n' \
  "$model_id" > "$STATE_FILE"
trap 'rm -f "$STATE_FILE"' EXIT INT TERM

printf '\033]2;Local Music Agent\007'

cd "$HOME"
exec pi \
  --tui-mode fullscreen \
  --model "local/$model_id" \
  --append-system-prompt "$HOME/.pi/agent/APPEND_SYSTEM_MUSIC.md" \
  --no-skills \
  --skill /var/home/samuel/.agents/skills/music \
  --mcp-config /var/home/samuel/.config/music/mcp.json \
  "$@"
