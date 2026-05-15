#!/usr/bin/env bash
if [[ $ROFI_RETV -eq 0 ]]; then
    fd -H -t d . /var/home/samuel/
elif [[ $ROFI_RETV -eq 1 ]]; then
    niri msg action spawn -- kitty -e yazi "$1"
fi
