#!/usr/bin/env bash
dirs=()

# Collect all directories whether passed as separate arguments or multiline string in $1
for arg in "$@"; do
    while IFS= read -r line || [ -n "$line" ]; do
        [ -z "$line" ] && continue
        # Strip any ANSI escape sequences
        clean=$(sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' <<< "$line")
        # Normalize ~/ to full home path
        clean=$(sed "s|^~/|/var/home/samuel/|" <<< "$clean")
        # Strip trailing slash if present
        clean="${clean%/}"
        [ -d "$clean" ] && dirs+=("$clean")
    done <<< "$arg"
done

[ ${#dirs[@]} -eq 0 ] && exit 0

if [ ${#dirs[@]} -eq 1 ]; then
    niri msg action spawn -- kitty -e yazi "${dirs[0]}"
    exit 0
fi

# Multi-directory selection: open in separate tabs within a single Yazi window
CLIENT_ID=$(( (RANDOM << 16) + RANDOM + 1 ))

# Launch Kitty with Yazi on the first directory
niri msg action spawn -- kitty -e yazi --client-id "$CLIENT_ID" "${dirs[0]}"

# Fully detached session so it cannot be killed when Television exits
setsid -f bash -c '
    CLIENT_ID="$1"
    shift
    for attempt in {1..50}; do
        sleep 0.1
        if ya emit-to "$CLIENT_ID" tab_create 2>/dev/null; then
            ya emit-to "$CLIENT_ID" cd "$1" 2>/dev/null
            shift
            for dir in "$@"; do
                ya emit-to "$CLIENT_ID" tab_create 2>/dev/null
                ya emit-to "$CLIENT_ID" cd "$dir" 2>/dev/null
            done
            ya emit-to "$CLIENT_ID" tab_switch 0 2>/dev/null
            exit 0
        fi
    done
' _ "$CLIENT_ID" "${dirs[@]:1}" >/dev/null 2>&1
