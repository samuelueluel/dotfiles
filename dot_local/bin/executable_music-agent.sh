#!/usr/bin/env bash
# Music Agent: dedicated pihat session with music skill and Last.fm MCP

MODEL="${PIHAT_MODEL:-openai-codex/gpt-5.6-luna}"
SCOPE="openrouter-us/**:max,openrouter-ds/**:max,openai-codex/**:max"
STATE_DIR="$HOME/.pi/running"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/$$.state"
export PI_STATE_FILE="$STATE_FILE"

printf 'type=pihat\nmodel=%s\nthinking=max\ncwd=Music\nsandbox=unsandboxed\n' "$MODEL" > "$STATE_FILE"
trap 'rm -f "$STATE_FILE"' EXIT INT TERM

printf '\033]2;Music Agent\007'

cd "$HOME"
exec pi \
  --tui-mode fullscreen \
  --model "$MODEL" \
  --models "$SCOPE" \
  --thinking max \
  --append-system-prompt "$HOME/.pi/agent/APPEND_SYSTEM_MUSIC.md" \
  --no-skills \
  --skill /var/home/samuel/.agents/skills/music \
  --mcp-config /var/home/samuel/.config/music/mcp.json \
  "$@"
