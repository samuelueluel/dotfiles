#!/usr/bin/env bash
# rmpc-fzf-newest-art.sh: Sort albums by file modification time with Cover Art preview

# 1. Fetch all albums with dates by paginating the query to avoid MPD truncation limits
# We call nc inside the loop to ensure each window is fully received.
DATA=$(
    for i in 0 5000 10000 15000 20000; do
        echo "find \"(album != '')\" window $i:$((i+5000))" | nc -N 127.0.0.1 6600
    done | awk -F": " '
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
            
            # Use a default time if missing
            time = (f_time != "" ? f_time : "1970-01-01T00:00:00Z")
            
            # Keep the newest modification time for each album
            if (!(key in latest) || time > latest[key]) {
                latest[key] = time
                first_file[key] = f_file
            }
        }
    }
    /^file: / { 
        process_record()
        f_file = get_val($0)
        f_artist=""; f_album=""; f_albumartist=""; f_time=""
    }
    /^Artist: / { f_artist = get_val($0) }
    /^Album: / { f_album = get_val($0) }
    /^AlbumArtist: / { f_albumartist = get_val($0) }
    /^Last-Modified: / { f_time = $2 }
    END {
        process_record()
        for (k in latest) print latest[k] "\t" k "\t" first_file[k]
    }' | sort -rn | cut -f2-
)

# 2. Multi-select fuzzy search
# We use Tab as delimiter to hide the file path from the list but pass it to preview
SELECTED_LINES=$(echo "$DATA" | fzf -m --ansi --reverse --no-sort --border=none --no-scrollbar --no-separator \
    --delimiter '\t' --with-nth 1 \
    --header="Recently Added Albums (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '/var/home/samuel/.local/bin/rmpc-preview-art.sh {1} {2}' \
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

        echo "findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
