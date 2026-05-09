#!/usr/bin/env bash
TARGET="$1"
[[ "$TARGET" != /* ]] && TARGET="$PWD/$TARGET"
niri msg action spawn -- kitty -e yazi "$TARGET"
