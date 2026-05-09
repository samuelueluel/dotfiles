#!/usr/bin/env bash
# Reads a pending note path from temp file, launches Obsidian if needed,
# waits for CLI to be ready, then opens the note in a new tab.
REL_PATH=$(cat /tmp/tv-obsidian-pending 2>/dev/null)
rm -f /tmp/tv-obsidian-pending
echo "launcher started, REL_PATH=$REL_PATH" >> /tmp/tv-obsidian-launcher.log
[ -z "$REL_PATH" ] && exit 1

if ! obsidian files total >/dev/null 2>&1; then
    flatpak run md.obsidian.Obsidian &
fi

for i in $(seq 1 30); do
    sleep 0.5
    if obsidian files total >/dev/null 2>&1; then
        echo "CLI ready at attempt $i, opening $REL_PATH" >> /tmp/tv-obsidian-launcher.log
        obsidian open "path=$REL_PATH" newtab
        exit 0
    fi
done
echo "timed out waiting for CLI" >> /tmp/tv-obsidian-launcher.log
