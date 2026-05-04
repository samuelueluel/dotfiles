#!/usr/bin/bash
# Fix tag separators: replace ' / ' with '; ' in grouping (TIT1) and genre (TCON)
# Usage: ./fix_separators.sh [--dry-run]

MUSIC_DIR="${MUSIC_DIR:-$HOME/Music/Music_Linux/mp3 library/Music}"
DRY_RUN=0
[[ "$1" == "--dry-run" ]] && DRY_RUN=1

changed=0
total=0

while IFS= read -r -d '' file; do
    total=$((total + 1))

    tit1=$(mid3v2 -l "$file" 2>/dev/null | grep -a "^TIT1=" | sed 's/^TIT1=//')
    tcon=$(mid3v2 -l "$file" 2>/dev/null | grep -a "^TCON=" | sed 's/^TCON=//')

    new_tit1="${tit1// \/ /; }"
    new_tcon="${tcon// \/ /; }"

    tit1_changed=0
    tcon_changed=0
    [[ "$tit1" != "$new_tit1" ]] && tit1_changed=1
    [[ "$tcon" != "$new_tcon" ]] && tcon_changed=1

    if [[ $tit1_changed -eq 1 || $tcon_changed -eq 1 ]]; then
        changed=$((changed + 1))
        echo "File: $file"
        [[ $tit1_changed -eq 1 ]] && echo "  TIT1: $tit1 -> $new_tit1"
        [[ $tcon_changed -eq 1 ]] && echo "  TCON: $tcon -> $new_tcon"

        if [[ $DRY_RUN -eq 0 ]]; then
            args=()
            [[ $tit1_changed -eq 1 ]] && args+=(--TIT1 "$new_tit1")
            [[ $tcon_changed -eq 1 ]] && args+=(--TCON "$new_tcon")
            mid3v2 "${args[@]}" "$file" 2>/dev/null
        fi
    fi
done < <(find -L "$MUSIC_DIR" -name "*.mp3" -print0)

echo ""
echo "Scanned: $total MP3s | Changed: $changed"
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — no files written)"
