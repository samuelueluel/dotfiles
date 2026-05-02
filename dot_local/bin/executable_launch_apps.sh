#!/bin/bash

# Launch Zen Personal
env MOZ_APP_REMOTINGNAME=zen-personal zen-browser -P "personal" --new-instance &

# Give it a second to start
sleep 2

# Launch Helium
helium &

# Give it a second to start
sleep 2

# Launch rmpc
kitty --class rmpc --title rmpc -e rmpc &

# Launch Alacritty
alacritty &
