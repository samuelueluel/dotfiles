#!/usr/bin/env bash
RG=/home/linuxbrew/.linuxbrew/bin/rg

echo -n "Search content: "
read -r query
[ -z "$query" ] && exit 0

selected=$(
    $RG -l "$query" "$PWD" |
    awk '{
      match($0, /.*\//);
      dir = substr($0, 1, RLENGTH);
      file = substr($0, RLENGTH+1);
      prefix = "/var/home/samuel/";
      if (index(dir, prefix) == 1) {
        rest_dir = substr(dir, length(prefix) + 1);
        printf "\033[38;2;208;167;175m%s\033[36m%s\033[0m%s\n", prefix, rest_dir, file;
      } else {
        printf "\033[36m%s\033[0m%s\n", dir, file;
      }
    }' |
    tv --source-command="cat" \
       --ansi \
       --source-output="{strip_ansi}" \
       --preview-command="$RG --color=always -C2 '$query' \"{strip_ansi}\"" \
       --preview-size=60 \
       --input-header="Results: $query" \
       --layout=portrait
)

[ -z "$selected" ] && exit 0

niri msg action spawn -- kitty -e yazi "$selected"
