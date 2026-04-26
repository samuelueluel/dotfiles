#!/usr/bin/env bash
set -euo pipefail

WAYPAPER_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/waypaper/config.ini"

cfg() { awk -F' = ' "/^$1/{print \$2}" "$WAYPAPER_CONFIG" 2>/dev/null; }

# Read folder from waypaper config; tilde-expand it
raw_dir=$(cfg folder)
WALLPAPER_DIR="${raw_dir/#\~/$HOME}"
WALLPAPER_DIR="${WALLPAPER_DIR:-$HOME/Pictures/Wallpapers}"

# Read transition settings from waypaper config
T_TYPE=$(cfg swww_transition_type); T_TYPE="${T_TYPE:-simple}"
T_STEP=$(cfg swww_transition_step); T_STEP="${T_STEP:-90}"
T_DUR=$(cfg swww_transition_duration); T_DUR="${T_DUR:-2}"
T_FPS=$(cfg swww_transition_fps); T_FPS="${T_FPS:-30}"

# swww-daemon is spawned by Niri, not systemd — wait for it
for i in $(seq 1 20); do
    swww query &>/dev/null && break
    sleep 0.5
done

wallpaper=$(find "$WALLPAPER_DIR" -maxdepth 1 -type f \
    \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \
       -o -name "*.gif" -o -name "*.webp" \) \
    | shuf -n 1)

[[ -z "$wallpaper" ]] && { echo "No wallpapers found in $WALLPAPER_DIR" >&2; exit 1; }

swww img "$wallpaper" \
    --transition-type "$T_TYPE" \
    --transition-step "$T_STEP" \
    --transition-duration "$T_DUR" \
    --transition-fps "$T_FPS"
