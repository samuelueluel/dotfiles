#!/usr/bin/env bash
# rmpc-fzf-newest-art.sh: Sort albums by file modification time with Cover Art preview

# 1. Fetch all albums with dates by paginating the query to avoid MPD truncation limits
DATA=$(
    # Run the query in chunks of 5000 to bypass MPD's output size limit
    for i in 0 5000 10000 15000 20000; do
        end=$((i+5000))
        echo "find \"(album != '')\" window $i:$end" | nc -N 127.0.0.1 6600
    done | awk -F": " '
    /^file: / { 
        if (f_artist != "" && f_album != "" && f_time != "") {
            key = "\033[38;2;23;193;130m[" f_artist "]\033[0m " f_album
            if (f_time > latest[key]) latest[key] = f_time
        }
        f_artist=""; f_album=""; f_time=""
    }
    /^Artist: / { f_artist=substr($0, index($0,$2)) }
    /^Album: / { f_album=substr($0, index($0,$2)) }
    /^Last-Modified: / { f_time=$2 }
    END {
        if (f_artist != "" && f_album != "" && f_time != "") {
            key = "\033[38;2;23;193;130m[" f_artist "]\033[0m " f_album
            if (f_time > latest[key]) latest[key] = f_time
        }
        for (k in latest) print latest[k] "\t" k
    }' | sort -rn | cut -f2-
)

# 2. Multi-select fuzzy search
SELECTED_LINES=$(echo "$DATA" | fzf -m --ansi --reverse --no-sort --border=none --no-scrollbar --no-separator \
    --header="Recently Added Albums (Tab: Select | Enter: Add)" \
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
