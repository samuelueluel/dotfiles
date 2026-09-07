#!/usr/bin/env bash
# Persistent local Music Agent: toggle a floating Ghostty client attached to tmux
set -euo pipefail

# Check if the local Ghostty client is currently open.
GHOSTTY_PID=$(pgrep -f "ghostty.*--title=Local Music Agent" | head -n1 || true)

if [[ -n "$GHOSTTY_PID" ]]; then
    FOCUSED_ID=$(niri msg --json focused-window 2>/dev/null | jq -r '.id // empty')
    WIN_ID=$(niri msg --json windows 2>/dev/null \
        | jq -r '.[] | select(.title == "Local Music Agent" and .app_id == "com.mitchellh.ghostty") | .id // empty' \
        | head -n1)

    if [[ -n "$WIN_ID" && "$FOCUSED_ID" == "$WIN_ID" ]]; then
        # Already focused -> hide it; Pi remains alive in tmux.
        kill "$GHOSTTY_PID"
        exit 0
    else
        # Open but unfocused -> focus it.
        if nirius focus -t '^Local Music Agent$' 2>/dev/null; then
            exit 0
        fi
    fi
fi

# Ensure the local background session exists with the tmux status bar disabled.
if ! tmux has-session -t music-agent-local 2>/dev/null; then
    tmux new-session -d -s music-agent-local \
        "/var/home/samuel/.local/bin/music-agent-local.sh"
    tmux set-option -t music-agent-local status off 2>/dev/null
fi

# Launch a floating Ghostty window attached to the persistent local session.
setsid -f ghostty --title="Local Music Agent" \
    -e tmux attach-session -t music-agent-local >/dev/null 2>&1
