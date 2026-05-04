#!/usr/bin/env bash
MUSIC_ROOT=$(grep '^music_directory' "$HOME/.config/mpd/mpd.conf" \
    | sed 's/music_directory[[:space:]]*"\(.*\)"/\1/' \
    | sed "s|^~|$HOME|")

if [ -z "$SELECTED_SONGS" ]; then
    notify-send "rmpc" "No songs selected" -t 2000
    exit 1
fi

PATHS=$(echo "$SELECTED_SONGS" \
    | while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$MUSIC_ROOT/$line"
    done)

echo "$PATHS" | wl-copy
