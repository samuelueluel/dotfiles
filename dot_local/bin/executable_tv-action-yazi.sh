#!/usr/bin/env bash
# tv-action-yazi.sh: Launch Yazi Float at a specific target
TARGET="$1"
if [ -z "$TARGET" ]; then
    exit 0
fi

# Ensure TARGET is absolute
if [[ "$TARGET" != /* ]]; then
    TARGET="$PWD/$TARGET"
fi

# Launch floating Yazi via Niri rule (env YAZI_FLOAT=1)
# Yazi accepts a path to focus/reveal it on startup
env YAZI_FLOAT=1 kitty --title "Yazi Float" -e zsh -c "exec yazi \"$TARGET\"" &
disown
