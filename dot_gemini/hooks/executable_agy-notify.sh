#!/usr/bin/env bash
# agy-notify.sh — Play ding sound and emit terminal BEL for Ghostty / niri-minimap urgency

# 1. Play audio chime asynchronously
paplay /usr/share/sounds/freedesktop/stereo/complete.oga >/dev/null 2>&1 &

# 2. Emit terminal BEL directly to the parent AGY process's controlling TTY
#    so Ghostty receives the BEL escape sequence and sets the Wayland/Niri urgency hint
parent_tty=$(ps -o tty= -p "$PPID" 2>/dev/null | tr -d ' ')
if [[ -n "$parent_tty" && "$parent_tty" != "?" && -w "/dev/$parent_tty" ]]; then
    printf '\a' > "/dev/$parent_tty" 2>/dev/null || true
fi

# Fallbacks for TTY writing
if [[ -w "/proc/$PPID/fd/0" ]]; then
    printf '\a' > "/proc/$PPID/fd/0" 2>/dev/null || true
fi
if [[ -w "/proc/$PPID/fd/1" ]]; then
    printf '\a' > "/proc/$PPID/fd/1" 2>/dev/null || true
fi
if [[ -w "/proc/$PPID/fd/2" ]]; then
    printf '\a' > "/proc/$PPID/fd/2" 2>/dev/null || true
fi
printf '\a' > /dev/tty 2>/dev/null || true

# 3. Output empty JSON as expected by AGY hook runner
echo '{}'
