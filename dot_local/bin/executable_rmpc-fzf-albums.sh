#!/usr/bin/env bash
# rmpc-fzf-albums.sh: Fuzzy search albums via fzf and play via MPD

# Use netcat to talk to MPD protocol on default port 6600
ALBUMS=$(echo "list album" | nc -N 127.0.0.1 6600 | grep "^Album: " | sed 's/^Album: //')

SELECTED=$(echo "$ALBUMS" | fzf --reverse --header="Search Albums" --prompt="Album > ")

if [ -n "$SELECTED" ]; then
    # Escape quotes for the MPD protocol
    ESCAPED_ALBUM=$(echo "$SELECTED" | sed 's/"/\\"/g')
    
    # Clear queue, add the album, and play
    # We send multiple commands to MPD
    (
        echo "clear"
        echo "findadd album \"$ESCAPED_ALBUM\""
        echo "play"
        echo "close"
    ) | nc -N 127.0.0.1 6600 > /dev/null
fi
