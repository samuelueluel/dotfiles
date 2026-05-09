#!/usr/bin/env bash
# tv-launcher.sh: Launcher for the Television Hub with channel handoff support.
# Hub actions write the next command to TV_NEXT_CMD; this script picks it up.

TV=/home/linuxbrew/.linuxbrew/bin/tv
NEXT=/tmp/tv-hub-next-cmd

sleep 0.1

rm -f "$NEXT"
"$TV" hub

while [ -f "$NEXT" ]; do
    cmd=$(cat "$NEXT")
    rm -f "$NEXT"
    eval "$cmd"
done
