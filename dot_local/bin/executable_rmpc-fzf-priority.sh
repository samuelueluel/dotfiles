#!/usr/bin/env bash
# rmpc-fzf-priority.sh: Multi-select search for albums with grouping = [Priority]

# 1. Get pairs where grouping contains [Priority] using find
# We use a loop to ensure we get everything if there are many matches
PAIRS=$(
    for i in 0 5000 10000; do
        echo "find \"(grouping contains '[Priority]')\" window $i:$((i+5000))" | nc -N 127.0.0.1 6600
    done | awk -F': ' '
    function get_val(line) {
        p = index(line, ": ")
        if (p == 0) return ""
        return substr(line, p + 2)
    }
    function process_record() {
        if (f_file != "" && f_album != "") {
            # Fallback logic: Artist -> AlbumArtist -> Unknown Artist
            artist = (f_artist != "" ? f_artist : (f_albumartist != "" ? f_albumartist : "Unknown Artist"))
            key = "\033[38;2;23;193;130m[" artist "]\033[0m " f_album
            if (!seen[key]) {
                seen[key] = 1
                print key "\t" f_file
            }
        }
    }
    /^file: / { 
        process_record()
        f_file = get_val($0)
        f_artist=""; f_album=""; f_albumartist=""
    }
    /^Artist: / { f_artist = get_val($0) }
    /^Album: / { f_album = get_val($0) }
    /^AlbumArtist: / { f_albumartist = get_val($0) }
    END {
        process_record()
    }
' | sort -u)

# 2. Multi-select with fzf
SELECTED_LINES=$(echo "$PAIRS" | fzf -m --ansi --reverse --border=none --no-scrollbar --no-separator \
    --delimiter '\t' --with-nth 1 \
    --header="Priority Albums (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '$HOME/.local/bin/rmpc-preview-art.sh {1} {2}' \
    --preview-window 'right:40%:border-left')

if [ -n "$SELECTED_LINES" ]; then
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue
        
        # Strip ANSI codes and hidden file path
        SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g' | cut -f1)
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
