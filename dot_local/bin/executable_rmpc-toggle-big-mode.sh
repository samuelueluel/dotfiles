#!/usr/bin/env bash

# File to track the current state
STATE_FILE="/tmp/rmpc_big_mode_active"
THEME_DIR="$HOME/.config/rmpc/themes"

if [ -f "$STATE_FILE" ]; then
    # Big mode is active, switch to normal
    rmpc remote set theme "$THEME_DIR/samuel.ron"
    rm "$STATE_FILE"
else
    # Big mode is not active, switch to big
    rmpc remote set theme "$THEME_DIR/samuel_big.ron"
    touch "$STATE_FILE"
fi
