#!/usr/bin/env bash

CONFIG_DIR="/var/home/samuel/.config/rmpc"
STATE_FILE="/tmp/rmpc_config_state"

# Determine current state
if [[ ! -f "$STATE_FILE" ]]; then
    echo "default" > "$STATE_FILE"
fi

CURRENT_STATE=$(cat "$STATE_FILE")

if [[ "$CURRENT_STATE" == "default" ]]; then
    cp "$CONFIG_DIR/config_big.ron" "$CONFIG_DIR/config.ron"
    echo "big" > "$STATE_FILE"
else
    cp "$CONFIG_DIR/config_default.ron" "$CONFIG_DIR/config.ron"
    echo "default" > "$STATE_FILE"
fi
