#!/usr/bin/env bash
# rmpc-fzf-song.sh: Multi-select Artist - Album - Song search with Cover Art preview
# Sibling of rmpc-fzf-art.sh; format is [Artist] (Album) Title instead of [Artist] Album.

# 1. Get every song with full tags via 'listallinfo' (one pass, fast, complete).
#    NB: the full response is ~6MB and MPD keeps the connection open after responding,
#    so 'nc -N' truncates it at the socket buffer (~2.9MB, ~half the library). We read
#    with Python until MPD's final "OK" line instead. (MPD 0.24 also rejects
#    'list title group artist album', so listallinfo is the only reliable source.)
DATA=$(python3 - <<'PYEOF' | sort -u
import socket, os
s = socket.create_connection(("127.0.0.1", 6600), timeout=10)
s.sendall(b"listallinfo\n")
buf = b""
while True:
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
    if buf.endswith(b"\nOK\n"):
        break
s.close()

songs = []
cur = None
for line in buf.decode("utf-8", "replace").splitlines():
    if line.startswith("file: "):
        if cur:
            songs.append(cur)
        cur = {"file": line[6:], "artist": "", "album": "", "title": ""}
    elif cur is not None:
        if line.startswith("Artist: "):
            cur["artist"] = line[8:]
        elif line.startswith("Album: "):
            cur["album"] = line[7:]
        elif line.startswith("Title: "):
            cur["title"] = line[7:]
if cur:
    songs.append(cur)

for sng in songs:
    a = sng["artist"] if sng["artist"] else "Unknown Artist"
    al = sng["album"] if sng["album"] else "Unknown Album"
    t = sng["title"] if sng["title"] else os.path.basename(sng["file"])
    print(f"\033[38;2;23;193;130m[{a}]\033[0m ({al}) {t}")
PYEOF
)

# 2. Multi-select with fzf (-m flag)
SELECTED_LINES=$(echo "$DATA" | fzf -m --ansi --reverse --border=none --no-scrollbar --no-separator \
    --header="Songs (Tab: Select | Enter: Add)" \
    --prompt="Fuzzy Search > " \
    --preview '$HOME/.local/bin/rmpc-preview-art.sh {}' \
    --preview-window 'right:40%:border-left')

if [ -n "$SELECTED_LINES" ]; then
    # Check if we are currently stopped
    STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')

    # 3. Loop through each selected line
    while IFS= read -r SELECTED; do
        [ -z "$SELECTED" ] && continue

        # Strip ANSI codes
        SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g')
        ARTIST=$(echo "$SELECTED_CLEAN" | sed -E 's/^\[([^]]*)\] \((.*)\) (.*)$/\1/')
        ALBUM=$(echo "$SELECTED_CLEAN" | sed -E 's/^\[([^]]*)\] \((.*)\) (.*)$/\2/')
        TITLE=$(echo "$SELECTED_CLEAN" | sed -E 's/^\[([^]]*)\] \((.*)\) (.*)$/\3/')
        [ -z "$TITLE" ] && continue

        ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
        ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')
        ESCAPED_TITLE=$(echo "$TITLE" | sed 's/"/\\"/g')

        # Add the song to the queue (findadd = exact match, so "Two-Headed Boy"
        # doesn't also pull in "Two-Headed Boy, Pt. 2" via substring matching)
        echo "findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\" title \"$ESCAPED_TITLE\"" | nc -N 127.0.0.1 6600 > /dev/null
    done <<< "$SELECTED_LINES"

    # 4. If nothing was playing, start playback
    if [ "$STATE" == "stop" ]; then
        echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    fi
    echo "close" | nc -N 127.0.0.1 6600 > /dev/null
fi
