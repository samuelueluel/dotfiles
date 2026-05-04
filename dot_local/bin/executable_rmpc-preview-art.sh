#!/usr/bin/env bash
# rmpc-preview-art.sh: Find and display cover art for an Artist - Album pair

# Clear any existing Kitty graphics in the preview area FIRST
# This ensures that even if we exit early, the previous image is removed.
# a=d means action=delete, d=A means delete all images
printf "\033_Ga=d,d=A\033\\"

MUSIC_DIR="${MUSIC_DIR:-$HOME/Music/Music_Linux/mp3 library/Music}"
INPUT="$1"

if [ -z "$INPUT" ]; then
    exit 0
fi

# Split "Artist - Album"
# Using sed to be robust against " - " inside names (greedy match for the last " - ")
ARTIST=$(echo "$INPUT" | sed 's/ - .*//')
ALBUM=$(echo "$INPUT" | sed 's/.* - //')

# Escape quotes for MPD
ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

# Get the path of the first file in this album
# We use 'find' to get one file, then 'dirname' to get the folder
RELATIVE_FILE=$(echo "find artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\"" | nc -N 127.0.0.1 6600 | grep "^file: " | head -n 1 | cut -d' ' -f2-)

if [ -z "$RELATIVE_FILE" ]; then
    echo "No files found for $ARTIST - $ALBUM"
    exit 0
fi

ALBUM_DIR="$MUSIC_DIR/$(dirname "$RELATIVE_FILE")"

# Possible cover names in priority order
COVER=""
for name in "cover.jpg" "cover.png" "cover.webp" "folder.jpg" "folder.png"; do
    if [ -f "$ALBUM_DIR/$name" ]; then
        COVER="$ALBUM_DIR/$name"
        break
    fi
done

# Fallback: Extract embedded art if no file found
TEMP_COVER="/tmp/rmpc_preview_embedded.jpg"
if [ -z "$COVER" ]; then
    if [ -n "$RELATIVE_FILE" ]; then
        # Try to extract the first video stream (covers are stored as video streams in many formats)
        ffmpeg -i "$MUSIC_DIR/$RELATIVE_FILE" -an -vcodec copy "$TEMP_COVER" -y -loglevel quiet
        if [ -s "$TEMP_COVER" ]; then
            COVER="$TEMP_COVER"
        fi
    fi
fi

if [ -n "$COVER" ]; then
    # Add manual vertical padding to center the image better in the fzf box
    # 2-3 newlines usually provides a good balance for the typical window height
    printf "\n\n"

    # Use chafa with kitty protocol
    # --align mid,mid centers the image both horizontally and vertically
    chafa --probe off --format kitty --animate no --align mid,mid --size "${FZF_PREVIEW_COLUMNS}x$((FZF_PREVIEW_LINES - 3))" "$COVER"
    
    # Cleanup if it was a temp file (chafa reads it into memory/terminal buffer immediately)
    [ "$COVER" = "$TEMP_COVER" ] && rm -f "$TEMP_COVER"
else
    echo "No cover art found (file or embedded) in:"
    echo "$ALBUM_DIR"
fi
