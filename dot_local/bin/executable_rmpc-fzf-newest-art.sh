#!/usr/bin/env bash
# rmpc-fzf-newest-art.sh: Sort albums by file modification time with Cover Art preview

# 1. Fetch all unique albums from beets items sorted by 'added' date
# We query items (no -a) to get the true '$artist' field, then deduplicate.
DATA=$(beet ls -f '$added|$artist|$album' | sort -u | sort -rn | awk -F'|' '
    {
        artist = ($2 != "" ? $2 : "Unknown Artist")
        # Format for display: [Artist] Album
        # We also pass the Artist and Album as hidden fields for the preview script
        printf "\033[38;2;23;193;130m[%s]\033[0m %s\t%s\t%s\n", artist, $3, artist, $3
    }
')

# 2. Multi-select fuzzy search
# We use Tab as delimiter to hide the raw fields from the list but pass them to preview
SELECTED_LINES=$(echo "$DATA" | fzf -m --ansi --reverse --no-sort --border=none --no-scrollbar --no-separator \
    --delimiter '\t' --with-nth 1 \
    --header="Recently Added Albums (Beets) (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '$HOME/.local/bin/rmpc-preview-art.sh {1}' \
    --preview-window 'right:40%:border-left')

if [ -n "$SELECTED_LINES" ]; then
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        # Strip ANSI codes and the hidden file path
        SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g' | cut -f1)
        ARTIST=$(echo "$SELECTED_CLEAN" | sed 's/^\[\([^]]*\)\].*/\1/')
        ALBUM=$(echo "$SELECTED_CLEAN" | sed 's/^\[[^]]*\] //')

        ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
        ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

        echo "searchadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
