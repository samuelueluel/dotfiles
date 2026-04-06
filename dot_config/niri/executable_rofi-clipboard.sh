#!/usr/bin/env bash
# Integration between cliphist and rofi.

if [ "$1" = "" ]; then
    # List available history
    cliphist list
else
    # Copy selected item to clipboard
    echo "$1" | cliphist decode | wl-copy
fi
