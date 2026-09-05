#!/usr/bin/env bash
# Focus the Music Agent if already open; otherwise launch a floating Ghostty session

if nirius focus -t "^Music Agent$" 2>/dev/null; then
    exit 0
fi

exec ghostty --title="Music Agent" -e /var/home/samuel/.local/bin/music-agent.sh
