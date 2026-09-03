#!/usr/bin/env bash
# Reads pending note paths from temp file, launches Obsidian if needed,
# waits for CLI to be ready, then opens each note in a new tab.
[ ! -s /tmp/tv-obsidian-pending ] && exit 1
PENDING_FILE="/tmp/tv-obsidian-pending"

if ! obsidian files total >/dev/null 2>&1; then
    flatpak run md.obsidian.Obsidian &
fi

for i in $(seq 1 30); do
    sleep 0.5
    if obsidian files total >/dev/null 2>&1; then
        while IFS= read -r REL_PATH || [ -n "$REL_PATH" ]; do
            [ -z "$REL_PATH" ] && continue
            echo "CLI ready at attempt $i, opening $REL_PATH" >> /tmp/tv-obsidian-launcher.log
            obsidian open "path=$REL_PATH" newtab
        done < "$PENDING_FILE"
        rm -f "$PENDING_FILE"
        exit 0
    fi
done
echo "timed out waiting for CLI" >> /tmp/tv-obsidian-launcher.log
rm -f "$PENDING_FILE"
