#!/usr/bin/env bash
query="$1"
path=$(sed 's|^~/|/var/home/samuel/|' <<< "$2")
/home/linuxbrew/.linuxbrew/bin/rg --color=always -C2 "$query" "$path"
