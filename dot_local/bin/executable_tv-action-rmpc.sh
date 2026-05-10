#!/usr/bin/env bash
# tv-action-rmpc.sh: Add a selected album to MPD queue from Television
LOG="/tmp/tv_action_rmpc.log"
exec 2>>"$LOG"

SELECTED="$1"
[ -z "$SELECTED" ] && exit 0

echo "--- $(date) ---" >> "$LOG"
echo "Action triggered for: '$SELECTED'" >> "$LOG"

# Strip ANSI codes manually to be 100% sure
SELECTED_CLEAN=$(echo "$SELECTED" | sed 's/\x1b\[[0-9;]*m//g')
echo "Cleaned string: '$SELECTED_CLEAN'" >> "$LOG"

# Parse [Artist] Album
if [[ "$SELECTED_CLEAN" =~ ^\[(.*)\]\ (.*)$ ]]; then
    ARTIST="${BASH_REMATCH[1]}"
    ALBUM="${BASH_REMATCH[2]}"
else
    # Fallback for "Artist - Album" format
    ARTIST=$(echo "$SELECTED_CLEAN" | sed 's/ - .*//')
    ALBUM=$(echo "$SELECTED_CLEAN" | sed 's/.* - //')
fi

echo "Parsed: Artist='$ARTIST', Album='$ALBUM'" >> "$LOG"

ESCAPED_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
ESCAPED_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

# Get current status to see if we need to play later
STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')
echo "MPD State: $STATE" >> "$LOG"

# Add the album to the queue
CMD="findadd artist \"$ESCAPED_ARTIST\" album \"$ESCAPED_ALBUM\""
echo "Sending to MPD: $CMD" >> "$LOG"
RESPONSE=$(echo "$CMD" | nc -N 127.0.0.1 6600)
echo "MPD Response: $RESPONSE" >> "$LOG"

# If nothing was playing, start playback
if [ "$STATE" == "stop" ]; then
    echo "play" | nc -N 127.0.0.1 6600 > /dev/null
fi
