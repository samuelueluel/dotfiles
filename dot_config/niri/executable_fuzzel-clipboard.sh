#!/usr/bin/env bash
# Clipboard history switcher using cliphist and fuzzel.

# 1. Get list from cliphist and pipe to fuzzel dmenu
# --width 100 makes it wider for clipboard snippets
# --lines 15 shows more history
selected=$(cliphist list | fuzzel --dmenu --width 100 --lines 15 --placeholder "Search clipboard history...")

# 2. Exit if nothing is selected (Esc pressed)
if [ -z "$selected" ]; then
    exit 0
fi

# 3. Decode and copy the selected item to the top of the clipboard
echo "$selected" | cliphist decode | wl-copy

exit 0
