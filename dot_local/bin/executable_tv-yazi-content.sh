#!/usr/bin/env bash
RG=/home/linuxbrew/.linuxbrew/bin/rg

echo -n "Search content: "
read -r query
[ -z "$query" ] && exit 0

selected=$(
    $RG -l "$query" "$PWD" |
    sed "s|$PWD/||" |
    tv --source-command="cat" \
       --preview-command="$RG --color=always -C2 '$query' \"$PWD\"/{}" \
       --preview-size=60 \
       --input-header="Results: $query"
)

[ -z "$selected" ] && exit 0

TARGET="$PWD/$selected"
niri msg action spawn -- kitty -e yazi "$TARGET"
