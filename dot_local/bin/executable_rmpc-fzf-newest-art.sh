#!/usr/bin/env bash
# rmpc-fzf-newest-art.sh: Sort albums by file modification time with Cover Art preview

# 1. Get all files with their last modified date, sort newest first
DATA=$(echo "listallinfo" | nc -N 127.0.0.1 6600 | awk -F': ' '
    /^Last-Modified:/ { time=$2 }
    /^Artist:/ { artist=$2 }
    /^Album:/ { if (time != "" && artist != "" && $2 != "") print time "\t" artist " - " $2 }
' | sort -rn | cut -f2- | awk '!seen[$0]++')

# 2. Multi-select fuzzy search
# --no-sort is CRITICAL here so fzf preserves our "newest first" order
SELECTED_LINES=$(echo "$DATA" | fzf -m --reverse --no-sort --border=none --no-scrollbar --no-separator \
    --header="Recently Added Albums (Tab: Select | Enter: Add)" \
    --prompt="Recent Art > " \
    --preview '/var/home/samuel/.local/bin/rmpc-preview-art.sh {}' \
    --preview-window 'right:50%:noborder')

if [ -n "$SELECTED_LINES" ]; then
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        ARTIST=$(echo "$SELECTED" | sed 's/ - .*//')
        ALBUM=$(echo "$SELECTED" | sed 's/.* - //')

        ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
        ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

        echo "findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
