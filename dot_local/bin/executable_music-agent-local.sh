#!/usr/bin/env bash
# Music Agent: dedicated local Pi session with music skill and Last.fm MCP
set -euo pipefail

MODEL_PICKER="${PI_LOCAL_MODEL_PICKER:-$HOME/.local/bin/pi-pick-local-model}"
MODEL_LOADER="${PI_LOCAL_MODEL_LOADER:-$HOME/.local/bin/lem-load-model}"

# Detached tmux launchers do not source .zshrc; keep every gum menu on the
# same New Mexico palette as ordinary pi/beta.
export GUM_CHOOSE_CURSOR_FOREGROUND="#1AAAD4"
export GUM_CHOOSE_SELECTED_FOREGROUND="#1AAAD4"
export GUM_CHOOSE_HEADER_FOREGROUND="#DA9E8A"

command -v "$MODEL_PICKER" >/dev/null 2>&1 || {
  printf 'Local Music Agent: model picker not found: %s\n' "$MODEL_PICKER" >&2
  exit 1
}
command -v "$MODEL_LOADER" >/dev/null 2>&1 || {
  printf 'Local Music Agent: model loader not found: %s\n' "$MODEL_LOADER" >&2
  exit 1
}

# Match ordinary pi/beta: every new local Music Agent session chooses its
# local model, even when that model is already resident in Lemonade.
model_id=$("$MODEL_PICKER") || exit 1
[[ -n "$model_id" ]] || exit 1

# Use the shared loader so local model startup gets the same Lemonade/gum menus
# and runtime settings as the ordinary pi command. No cloud model is a fallback.
"$MODEL_LOADER" "$model_id"

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
