#!/usr/bin/env bash
# Persistent Music Agent: Toggle floating Ghostty client attached to a background tmux session

# Check if Ghostty client is currently open
GHOSTTY_PID=$(pgrep -f "ghostty.*--title=Music Agent" | head -n1)

if [[ -n "$GHOSTTY_PID" ]]; then
    FOCUSED_ID=$(niri msg --json focused-window 2>/dev/null | jq -r '.id // empty')
    WIN_ID=$(niri msg --json windows 2>/dev/null | jq -r '.[] | select(.title == "Music Agent" and .app_id == "com.mitchellh.ghostty") | .id // empty' | head -n1)

    if [[ -n "$WIN_ID" && "$FOCUSED_ID" == "$WIN_ID" ]]; then
        # Already focused -> hide it (detaches cleanly from tmux; Pi session stays alive)
        kill "$GHOSTTY_PID"
        exit 0
    else
        # Open but unfocused -> focus it
        if nirius focus -t "^Music Agent$" 2>/dev/null; then
            exit 0
        fi
    fi
fi

# Ensure the background tmux session exists with status bar turned off
if ! tmux has-session -t music-agent 2>/dev/null; then
    tmux new-session -d -s music-agent "/var/home/samuel/.local/bin/music-agent.sh"
    tmux set-option -t music-agent status off 2>/dev/null
fi

# Launch floating Ghostty window attached to the persistent tmux session
setsid -f ghostty --title="Music Agent" -e tmux attach-session -t music-agent >/dev/null 2>&1
