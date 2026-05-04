#!/usr/bin/env bash
# rmpc-fzf-art.sh: Multi-select Artist - Album search with Cover Art preview

# 1. Get pairs
PAIRS=$(echo "list album group artist" | nc -N 127.0.0.1 6600 | awk -F': ' '
    /^Artist:/ { artist=$2 }
    /^Album:/ { if (artist != "" && $2 != "") print artist " - " $2 }
' | sort -u)

# 2. Multi-select with fzf (-m flag)
# Use Tab or Shift-Tab to select multiple items
SELECTED_LINES=$(echo "$PAIRS" | fzf -m --reverse --border=none --no-scrollbar --no-separator \
    --header="Tab: Select multiple | Enter: Add to Queue" \
    --prompt="Art Search > " \
    --preview '/var/home/samuel/.local/bin/rmpc-preview-art.sh {}' \
    --preview-window 'right:50%:noborder')

if [ -n "$SELECTED_LINES" ]; then
    # Check if we are currently stopped
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    # 3. Loop through each selected line
    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        ARTIST=$(echo "$SELECTED" | sed 's/ - .*//')
        ALBUM=$(echo "$SELECTED" | sed 's/.* - //')

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
