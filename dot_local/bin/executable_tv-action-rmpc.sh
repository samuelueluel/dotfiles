#!/usr/bin/env bash
# tv-action-rmpc.sh: Add/Replace selected album(s) in MPD queue from Television
LOG="/tmp/tv_action_rmpc.log"
exec 2>>"$LOG"

# $1 is the items, $2 is the mode (add or replace)
ITEMS="$1"
MODE="${2:-add}"

[ -z "$ITEMS" ] && exit 0

echo "--- $(date) ---" >> "$LOG"
echo "Action triggered: MODE=$MODE, ITEMS=$# items" >> "$LOG"

# Logic for handling an item
handle_item() {
    local ITEM="$1"
    [ -z "$ITEM" ] && return
    
    echo "Processing: '$ITEM'" >> "$LOG"

    # Strip ANSI codes
    local CLEAN=$(echo "$ITEM" | sed 's/\x1b\[[0-9;]*m//g')
    
    local ARTIST ALBUM
    if [[ "$CLEAN" =~ ^\[([^\]]*)\]\ (.*)$ ]]; then
        ARTIST="${BASH_REMATCH[1]}"
        ALBUM="${BASH_REMATCH[2]}"
    else
        ARTIST=$(echo "$CLEAN" | sed 's/ - .*//')
        ALBUM=$(echo "$CLEAN" | sed 's/.* - //')
    fi

    echo "Parsed: Artist='$ARTIST', Album='$ALBUM'" >> "$LOG"

    local ESC_ARTIST=$(echo "$ARTIST" | sed 's/"/\\"/g')
    local ESC_ALBUM=$(echo "$ALBUM" | sed 's/"/\\"/g')

    local CMD="findadd artist \"$ESC_ARTIST\" album \"$ESC_ALBUM\""
    echo "Sending to MPD: $CMD" >> "$LOG"
    echo "$CMD" | nc -N 127.0.0.1 6600 >> "$LOG" 2>&1
}

# If mode is replace, clear the queue first
if [ "$MODE" == "replace" ]; then
    echo "Clearing MPD queue" >> "$LOG"
    echo "clear" | nc -N 127.0.0.1 6600 > /dev/null
fi

# Split the smashed input from Television
CLEAN_INPUT=$(echo "$ITEMS" | sed 's/\x1b\[[0-9;]*m//g')
PARSED_ITEMS=$(echo "$CLEAN_INPUT" | sed 's/ \[/\n[/g')

while IFS= read -r LINE; do
    handle_item "$LINE"
done <<< "$PARSED_ITEMS"

# Start playback
# For replace, we always want to play. For add, only if stopped.
STATE=$(echo "status" | nc -N 127.0.0.1 6600 | grep "^state: " | awk '{print $2}')
if [ "$MODE" == "replace" ] || [ "$STATE" == "stop" ]; then
    echo "play" | nc -N 127.0.0.1 6600 > /dev/null
    echo "Triggering playback" >> "$LOG"
fi
