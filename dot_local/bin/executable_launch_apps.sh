#!/bin/bash

# Launch Zen Personal
env MOZ_APP_REMOTINGNAME=zen-personal zen-browser -P "personal" --new-instance &

# Launch Zen Utility
env MOZ_APP_REMOTINGNAME=zen-utility zen-browser -P "utility" --new-instance &

# Launch Quod Libet
flatpak run io.github.quodlibet.QuodLibet &

# Launch Alacritty
alacritty &
