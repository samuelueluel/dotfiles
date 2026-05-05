#!/usr/bin/env bash
# rmpc-fzf-priority.sh: Multi-select search for albums with grouping = [Priority]

# 1. Get pairs where grouping contains [Priority] using find
PAIRS=$(echo "find \"(grouping contains '[Priority]')\"" | nc -N 127.0.0.1 6600 | awk -F': ' '
    /^Artist: / { artist=substr($0, index($0,$2)) }
    /^Album: / { album=substr($0, index($0,$2)); if (artist != "" && album != "") print "\033[38;2;23;193;130m[" artist "]\033[0m " album }
' | sort -u)

# 2. Multi-select with fzf
SELECTED_LINES=$(echo "$PAIRS" | fzf -m --ansi --reverse --border=none --no-scrollbar --no-separator \
    --header="Priority Albums (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '/var/home/samuel/.local/bin/rmpc-preview-art.sh {}' \
    --preview-window 'right:40%:border-left')

if [ -n "$SELECTED_LINES" ]; then
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        # Strip ANSI codes
        SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g')
        ARTIST=$(echo "$SELECTED_CLEAN" | sed 's/^\[\([^]]*\)\].*/\1/')
        ALBUM=$(echo "$SELECTED_CLEAN" | sed 's/^\[[^]]*\] //')

        ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
        ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

        echo "findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
