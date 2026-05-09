#!/usr/bin/env bash
RG=/home/linuxbrew/.linuxbrew/bin/rg

echo -n "Search content: "
read -r query
[ -z "$query" ] && exit 0

selected=$(
    $RG -l "$query" "$PWD" |
    tv --source-command="cat" \
       --preview-command="$RG --color=always -C2 '$query' \"{}\"" \
       --preview-size=60 \
       --input-header="Results: $query" \
       --layout=portrait
)

[ -z "$selected" ] && exit 0

niri msg action spawn -- kitty -e yazi "$selected"
