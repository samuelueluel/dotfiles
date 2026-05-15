#!/usr/bin/env bash
if [[ $ROFI_RETV -eq 0 ]]; then
    fd -H -t f . /var/home/samuel/
elif [[ $ROFI_RETV -eq 1 ]]; then
    xdg-open "$1"
fi
