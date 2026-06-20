#!/bin/bash

# 1. If fuzzel (launcher) is open, close it and stop.
if pgrep -x "fuzzel" > /dev/null; then
    pkill -x "fuzzel"
    exit 0
fi

# 2. Containerized-agent guard.
#    Ghostty 1.3.1 deadlocks on a Wayland close-window request when the focused window is
#    running a `podman -it` AI-agent session: Surface.finalize blocks in pthread_join on the
#    surface IO thread, which only exits on PTY EOF (ghostty#4882). The agent's foreground
#    (podman+tmux+pi) keeps the PTY open, so the join — and, under gtk-single-instance, the
#    whole Ghostty process and every window — hangs until the container is killed.
#    Fix: if the focused window is an agent, tear its container down FIRST (-> PTY EOF), then
#    close the now-plain shell window normally.
#    Window title is set by Ghostty shell-integration to the running command name.
#      pi / pihat   -> general containers : pi-safe-{1,2,3}-PID   (match: ^pi-safe-[0-9])
#      beta/betahat -> stata containers   : pi-safe-stata-{1,2}-PID (match: ^pi-safe-stata-)
focused=$(niri msg --json focused-window 2>/dev/null)
app_id=$(printf '%s' "$focused" | jq -r '.app_id // empty' 2>/dev/null)
title=$(printf '%s' "$focused" | jq -r '.title // empty' 2>/dev/null)

if [ "$app_id" = "com.mitchellh.ghostty" ]; then
    case "$title" in
        pi|pihat)     pat='^pi-safe-[0-9]'  ;;
        beta|betahat) pat='^pi-safe-stata-' ;;
        *)            pat=''                ;;
    esac
    if [ -n "$pat" ]; then
        # Best-effort; force + zero-timeout so the PTY EOFs immediately.
        podman ps --format '{{.Names}}' 2>/dev/null \
            | grep -E "$pat" \
            | xargs -r podman rm -f -t0 >/dev/null 2>&1
    fi
fi

# 3. Close the window (now safe: agent PTY has EOF'd, or it was a normal window).
niri msg action close-window
