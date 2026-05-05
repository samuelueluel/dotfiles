#!/usr/bin/env bash
# rmpc-fzf-art.sh: Multi-select Artist - Album search with Cover Art preview

# 1. Get pairs using 'list' which is the most reliable way to get all albums
# We use Artist as the grouping tag. This is fast and complete.
DATA=$(echo "list album group artist" | nc -N 127.0.0.1 6600 | awk -F': ' '
    /^Artist: / { artist=substr($0, index($0,$2)) }
    /^Album: / { 
        album=substr($0, index($0,$2))
        if (album != "") {
            # Use "Unknown Artist" if artist is empty
            a = (artist != "" ? artist : "Unknown Artist")
            print "\033[38;2;23;193;130m[" a "]\033[0m " album
        }
    }
' | sort -u)

# 2. Multi-select with fzf (-m flag)
SELECTED_LINES=$(echo "$DATA" | fzf -m --ansi --reverse --border=none --no-scrollbar --no-separator \
    --header="Albums (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '/var/home/samuel/.local/bin/rmpc-preview-art.sh {}' \
    --preview-window 'right:40%:border-left')

if [ -n "$SELECTED_LINES" ]; then
    # Check if we are currently stopped
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    # 3. Loop through each selected line
    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        # Strip ANSI codes
        SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g')
        ARTIST=$(echo "$SELECTED_CLEAN" | sed 's/^\[\([^]]*\)\].*/\1/')
        ALBUM=$(echo "$SELECTED_CLEAN" | sed 's/^\[[^]]*\] //')

        ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
        ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

        # Add the album to the queue
        echo "findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    # 4. If nothing was playing, start playback
    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
