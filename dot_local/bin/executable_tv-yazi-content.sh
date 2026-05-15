#!/usr/bin/env bash
RG=/home/linuxbrew/.linuxbrew/bin/rg

echo -n "Search content: "
read -r query
[ -z "$query" ] && exit 0

while true; do
    output=$(
        $RG -l "$query" "$PWD" |
        awk '{
          gsub("/var/home/samuel/", "~/");
          match($0, /.*\//);
          dir = substr($0, 1, RLENGTH);
          file = substr($0, RLENGTH+1);
          printf "\033[36m%s\033[0m%s\n", dir, file;
        }' |
        tv --source-command="cat" \
           --ansi \
           --source-output="{strip_ansi}" \
           --preview-command="/var/home/samuel/.local/bin/tv-ripgrep-preview.sh '$query' '{strip_ansi}'" \
           --preview-size=60 \
           --input-header="Results: $query" \
           --layout=portrait \
           --expect='ctrl-c'
    )

    [ -z "$output" ] && exit 0

    key=$(head -1 <<< "$output")
    path=$(tail -1 <<< "$output")
    path=$(sed 's|^~/|/var/home/samuel/|' <<< "$path")

    if [ "$key" = "ctrl-c" ]; then
        printf '%s' "$path" | wl-copy
    else
        niri msg action spawn -- kitty -e yazi "$path"
        exit 0
    fi
done
