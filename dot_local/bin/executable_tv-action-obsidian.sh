#!/usr/bin/env bash
TARGET="$1"
[ -z "$TARGET" ] && exit 0

OBSIDIAN_JSON="${HOME}/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json"
VAULT_DIR=$(python3 -c "
import json, sys
data = json.load(open('${OBSIDIAN_JSON}'))
vaults = list(data.get('vaults', {}).values())
open_vault = next((v for v in vaults if v.get('open')), vaults[0])
print(open_vault['path'])
" 2>/dev/null)
[ -z "$VAULT_DIR" ] && VAULT_DIR="/var/home/samuel/Dropbox/Sam_Personal_Vault"
VAULT_NAME=$(basename "$VAULT_DIR")

[[ "$TARGET" != /* ]] && TARGET="$VAULT_DIR/$TARGET"
REL_PATH="${TARGET#$VAULT_DIR/}"

if obsidian files total >/dev/null 2>&1; then
    obsidian open "path=$REL_PATH" newtab
else
    echo "$REL_PATH" > /tmp/tv-obsidian-pending
    niri msg action spawn -- /var/home/samuel/.local/bin/tv-obsidian-launcher.sh
fi
