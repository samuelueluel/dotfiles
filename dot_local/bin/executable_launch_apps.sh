#!/bin/bash

# Launch Zen Personal
env MOZ_APP_REMOTINGNAME=zen-personal zen-browser -P "personal" &

# Give it a second to start
sleep 2

# Launch Zen Utility
env MOZ_APP_REMOTINGNAME=zen-utility zen-browser -P "utility" &

# Give it a second to start
sleep 2

# Launch rmpc
kitty --class rmpc --title rmpc -e rmpc &

# Launch Ghostty
ghostty &
